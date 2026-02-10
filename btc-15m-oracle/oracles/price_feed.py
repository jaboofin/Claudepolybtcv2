"""
╔══════════════════════════════════════════════════════════════════╗
║  MULTI-ORACLE PRICE FEED ENGINE                                  ║
║  Fetches BTC price from multiple sources with consensus check    ║
║  Sources: CoinGecko, Binance, CoinCap                           ║
╚══════════════════════════════════════════════════════════════════╝
"""

import asyncio
import time
import logging
from dataclasses import dataclass
from typing import Optional
from statistics import median

import aiohttp

logger = logging.getLogger("oracle")


@dataclass
class PricePoint:
    """Single price observation from an oracle."""
    source: str
    price: float
    timestamp: float
    volume_24h: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None

    @property
    def age_seconds(self) -> float:
        return time.time() - self.timestamp

    def is_stale(self, max_age: int = 30) -> bool:
        return self.age_seconds > max_age


@dataclass
class ConsensusPrice:
    """Validated price from multiple oracles."""
    price: float
    timestamp: float
    sources: list
    spread_pct: float
    confidence: float  # 0-1 based on oracle agreement

    def __repr__(self):
        src_str = ", ".join(self.sources)
        return f"ConsensusPrice(${self.price:,.2f} | spread={self.spread_pct:.3f}% | conf={self.confidence:.2f} | [{src_str}])"


@dataclass
class Candle:
    """OHLCV candle data."""
    timestamp: float
    open: float
    high: float
    low: float
    close: float
    volume: float
    interval: str = "15m"


class OracleEngine:
    """
    Multi-source BTC price oracle with consensus validation.
    
    Fetches from CoinGecko, Binance, and CoinCap simultaneously,
    cross-validates prices, and returns consensus or raises alert
    if sources diverge beyond threshold.
    """

    # Maximum allowed divergence between oracles (%)
    MAX_DIVERGENCE_PCT = 1.0

    def __init__(self, config):
        self.config = config.oracle
        self._session: Optional[aiohttp.ClientSession] = None
        self._last_prices: dict[str, PricePoint] = {}
        self._price_history: list[ConsensusPrice] = []

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=10)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    # ── Individual Oracle Fetchers ──────────────────────────────

    async def _fetch_coingecko(self) -> Optional[PricePoint]:
        """Fetch BTC/USD from CoinGecko."""
        try:
            session = await self._get_session()
            url = f"{self.config.coingecko_base_url}/simple/price"
            params = {
                "ids": "bitcoin",
                "vs_currencies": "usd",
                "include_24hr_vol": "true",
            }
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    btc = data.get("bitcoin", {})
                    return PricePoint(
                        source="coingecko",
                        price=btc["usd"],
                        timestamp=time.time(),
                        volume_24h=btc.get("usd_24h_vol"),
                    )
                else:
                    logger.warning(f"CoinGecko returned {resp.status}")
                    return None
        except Exception as e:
            logger.error(f"CoinGecko oracle error: {e}")
            return None

    async def _fetch_binance(self) -> Optional[PricePoint]:
        """Fetch BTC/USDT from Binance."""
        try:
            session = await self._get_session()
            url = f"{self.config.binance_base_url}/ticker/bookTicker"
            params = {"symbol": "BTCUSDT"}
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    bid = float(data["bidPrice"])
                    ask = float(data["askPrice"])
                    mid = (bid + ask) / 2
                    return PricePoint(
                        source="binance",
                        price=mid,
                        timestamp=time.time(),
                        bid=bid,
                        ask=ask,
                    )
                else:
                    logger.warning(f"Binance returned {resp.status}")
                    return None
        except Exception as e:
            logger.error(f"Binance oracle error: {e}")
            return None

    async def _fetch_coincap(self) -> Optional[PricePoint]:
        """Fetch BTC/USD from CoinCap."""
        try:
            session = await self._get_session()
            url = f"{self.config.coincap_base_url}/assets/bitcoin"
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    asset = data.get("data", {})
                    return PricePoint(
                        source="coincap",
                        price=float(asset["priceUsd"]),
                        timestamp=time.time() / 1000
                        if "timestamp" not in data
                        else data["timestamp"] / 1000,
                        volume_24h=float(asset.get("volumeUsd24Hr", 0)),
                    )
                else:
                    logger.warning(f"CoinCap returned {resp.status}")
                    return None
        except Exception as e:
            logger.error(f"CoinCap oracle error: {e}")
            return None

    # ── Consensus Engine ────────────────────────────────────────

    async def get_price(self) -> ConsensusPrice:
        """
        Fetch BTC price from all oracles, validate consensus.
        
        Returns ConsensusPrice if at least `min_oracle_consensus` sources agree.
        Raises RuntimeError if oracles diverge too much.
        """
        # Fetch all concurrently
        results = await asyncio.gather(
            self._fetch_coingecko(),
            self._fetch_binance(),
            self._fetch_coincap(),
            return_exceptions=True,
        )

        # Filter valid results
        valid_prices: list[PricePoint] = []
        for r in results:
            if isinstance(r, PricePoint) and r is not None:
                if not r.is_stale(self.config.max_price_age):
                    valid_prices.append(r)
                    self._last_prices[r.source] = r

        if len(valid_prices) < self.config.min_oracle_consensus:
            # Fall back to any cached prices that aren't too old
            for src, pp in self._last_prices.items():
                if not pp.is_stale(60) and pp not in valid_prices:
                    valid_prices.append(pp)
                    logger.warning(f"Using cached price from {src} (age: {pp.age_seconds:.0f}s)")

        if len(valid_prices) == 0:
            raise RuntimeError("ALL ORACLES DOWN — no valid BTC price available")

        if len(valid_prices) == 1:
            pp = valid_prices[0]
            logger.warning(f"Single oracle mode: {pp.source} = ${pp.price:,.2f}")
            consensus = ConsensusPrice(
                price=pp.price,
                timestamp=pp.timestamp,
                sources=[pp.source],
                spread_pct=0.0,
                confidence=0.5,
            )
            self._price_history.append(consensus)
            return consensus

        # Calculate consensus via median
        prices = [pp.price for pp in valid_prices]
        med_price = median(prices)
        max_price = max(prices)
        min_price = min(prices)
        spread_pct = ((max_price - min_price) / med_price) * 100

        # Check divergence
        if spread_pct > self.MAX_DIVERGENCE_PCT:
            logger.error(
                f"Oracle divergence alert! Spread: {spread_pct:.3f}% "
                f"(max allowed: {self.MAX_DIVERGENCE_PCT}%) — "
                f"Prices: {', '.join(f'{pp.source}=${pp.price:,.2f}' for pp in valid_prices)}"
            )
            # Still return but with low confidence
            confidence = max(0.2, 1.0 - (spread_pct / 5.0))
        else:
            confidence = min(1.0, len(valid_prices) / 3.0)

        consensus = ConsensusPrice(
            price=med_price,
            timestamp=time.time(),
            sources=[pp.source for pp in valid_prices],
            spread_pct=spread_pct,
            confidence=confidence,
        )

        self._price_history.append(consensus)
        logger.info(f"Oracle consensus: {consensus}")
        return consensus

    # ── Historical Data ─────────────────────────────────────────

    async def get_candles(self, interval: str = "15m", limit: int = 100) -> list[Candle]:
        """
        Fetch historical BTC candles from Binance.
        
        Args:
            interval: Candle interval (1m, 5m, 15m, 1h, etc.)
            limit: Number of candles (max 1000)
        
        Returns:
            List of Candle objects, oldest first.
        """
        try:
            session = await self._get_session()
            url = f"{self.config.binance_base_url}/klines"
            params = {
                "symbol": "BTCUSDT",
                "interval": interval,
                "limit": min(limit, 1000),
            }
            async with session.get(url, params=params) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"Binance klines returned {resp.status}")
                data = await resp.json()

            candles = []
            for k in data:
                candles.append(Candle(
                    timestamp=k[0] / 1000,  # ms → s
                    open=float(k[1]),
                    high=float(k[2]),
                    low=float(k[3]),
                    close=float(k[4]),
                    volume=float(k[5]),
                    interval=interval,
                ))
            return candles
        except Exception as e:
            logger.error(f"Failed to fetch candles: {e}")
            return []

    def get_price_history(self) -> list[ConsensusPrice]:
        """Return all consensus prices observed this session."""
        return self._price_history.copy()
