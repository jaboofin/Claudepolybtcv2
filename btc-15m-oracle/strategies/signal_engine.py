"""
╔══════════════════════════════════════════════════════════════════╗
║  STRATEGY ENGINE — MULTI-SIGNAL BTC 15-MIN PREDICTOR            ║
║  Combines momentum, RSI, MACD, and EMA crossover signals        ║
║  Returns weighted confidence score + direction                   ║
╚══════════════════════════════════════════════════════════════════╝
"""

import logging
import math
from dataclasses import dataclass, field
from typing import Optional

from config.settings import MarketDirection, StrategyConfig
from oracles.price_feed import Candle, ConsensusPrice

logger = logging.getLogger("strategy")


@dataclass
class Signal:
    """Individual technical signal."""
    name: str
    direction: MarketDirection
    strength: float  # 0.0 to 1.0
    raw_value: float
    description: str


@dataclass
class StrategyDecision:
    """Aggregated strategy output."""
    direction: MarketDirection
    confidence: float          # 0.0 to 1.0
    signals: list[Signal]
    current_price: float
    volatility_pct: float
    should_trade: bool
    reason: str
    position_size_pct: float   # Suggested % of capital

    def summary(self) -> str:
        sigs = " | ".join(
            f"{s.name}={s.direction.value}({s.strength:.2f})" for s in self.signals
        )
        return (
            f"[{self.direction.value.upper()}] conf={self.confidence:.2f} "
            f"trade={self.should_trade} size={self.position_size_pct:.1f}% | {sigs}"
        )


class StrategyEngine:
    """
    Multi-indicator strategy for BTC 15-min prediction markets.
    
    Combines:
      1. Price momentum (short-term trend direction)
      2. RSI (overbought/oversold reversal detection)
      3. MACD (trend strength and crossover)
      4. EMA crossover (fast/slow moving average trend)
    
    Outputs a weighted confidence score and UP/DOWN/HOLD decision.
    """

    def __init__(self, config: StrategyConfig):
        self.config = config
        self._trade_history: list[StrategyDecision] = []

    # ── Technical Indicator Calculations ────────────────────────

    @staticmethod
    def _ema(data: list[float], period: int) -> list[float]:
        """Exponential Moving Average."""
        if len(data) < period:
            return [sum(data) / len(data)] * len(data)
        
        multiplier = 2 / (period + 1)
        ema_values = [sum(data[:period]) / period]  # SMA seed
        
        for price in data[period:]:
            ema_values.append(price * multiplier + ema_values[-1] * (1 - multiplier))
        
        return ema_values

    @staticmethod
    def _rsi(closes: list[float], period: int = 14) -> float:
        """Relative Strength Index (Wilder's smoothing)."""
        if len(closes) < period + 1:
            return 50.0  # Neutral if insufficient data
        
        deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
        gains = [d if d > 0 else 0 for d in deltas]
        losses = [-d if d < 0 else 0 for d in deltas]
        
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        
        for i in range(period, len(deltas)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    @staticmethod
    def _macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
        """MACD line, signal line, histogram."""
        if len(closes) < slow + signal:
            return 0.0, 0.0, 0.0
        
        ema_fast = StrategyEngine._ema(closes, fast)
        ema_slow = StrategyEngine._ema(closes, slow)
        
        # Align lengths
        min_len = min(len(ema_fast), len(ema_slow))
        macd_line = [ema_fast[-(min_len - i)] - ema_slow[-(min_len - i)] for i in range(min_len)]
        
        if len(macd_line) < signal:
            return macd_line[-1] if macd_line else 0.0, 0.0, 0.0
        
        signal_line = StrategyEngine._ema(macd_line, signal)
        histogram = macd_line[-1] - signal_line[-1]
        
        return macd_line[-1], signal_line[-1], histogram

    def _calculate_volatility(self, candles: list[Candle]) -> float:
        """Calculate rolling volatility as % price change std dev."""
        if len(candles) < 2:
            return 0.0
        
        returns = []
        for i in range(1, len(candles)):
            pct = ((candles[i].close - candles[i - 1].close) / candles[i - 1].close) * 100
            returns.append(pct)
        
        mean_ret = sum(returns) / len(returns)
        variance = sum((r - mean_ret) ** 2 for r in returns) / len(returns)
        return math.sqrt(variance)

    # ── Signal Generators ───────────────────────────────────────

    def _signal_momentum(self, candles: list[Candle]) -> Signal:
        """Short-term price momentum over lookback period."""
        lookback = min(self.config.momentum_lookback, len(candles) - 1)
        if lookback < 1:
            return Signal("momentum", MarketDirection.HOLD, 0.0, 0.0, "Insufficient data")
        
        current = candles[-1].close
        past = candles[-(lookback + 1)].close
        pct_change = ((current - past) / past) * 100
        
        # Normalize strength: 0.1% change = 0.5 strength, 0.5% = 1.0
        strength = min(1.0, abs(pct_change) / 0.5)
        
        if pct_change > 0.02:
            direction = MarketDirection.UP
        elif pct_change < -0.02:
            direction = MarketDirection.DOWN
        else:
            direction = MarketDirection.HOLD
            strength = 0.0
        
        return Signal(
            "momentum", direction, strength, pct_change,
            f"{lookback}-candle momentum: {pct_change:+.3f}%"
        )

    def _signal_rsi(self, candles: list[Candle]) -> Signal:
        """RSI-based reversal signal."""
        closes = [c.close for c in candles]
        rsi = self._rsi(closes, self.config.rsi_period)
        
        if rsi > self.config.rsi_overbought:
            direction = MarketDirection.DOWN  # Overbought → expect reversal down
            strength = min(1.0, (rsi - self.config.rsi_overbought) / 15)
        elif rsi < self.config.rsi_oversold:
            direction = MarketDirection.UP   # Oversold → expect reversal up
            strength = min(1.0, (self.config.rsi_oversold - rsi) / 15)
        else:
            # Neutral zone — slight directional bias
            center = 50.0
            if rsi > center:
                direction = MarketDirection.UP
                strength = (rsi - center) / (self.config.rsi_overbought - center) * 0.3
            else:
                direction = MarketDirection.DOWN
                strength = (center - rsi) / (center - self.config.rsi_oversold) * 0.3
        
        return Signal("rsi", direction, strength, rsi, f"RSI={rsi:.1f}")

    def _signal_macd(self, candles: list[Candle]) -> Signal:
        """MACD crossover and histogram signal."""
        closes = [c.close for c in candles]
        macd_line, signal_line, histogram = self._macd(
            closes, self.config.macd_fast, self.config.macd_slow, self.config.macd_signal
        )
        
        # Histogram direction + magnitude
        if histogram > 0:
            direction = MarketDirection.UP
        elif histogram < 0:
            direction = MarketDirection.DOWN
        else:
            direction = MarketDirection.HOLD
        
        # Normalize: histogram relative to price
        current_price = closes[-1] if closes else 1
        normalized = abs(histogram) / current_price * 10000  # basis points
        strength = min(1.0, normalized / 10)  # 10 bps = full strength
        
        # Crossover detection: boost strength
        if len(closes) > 2:
            prev_macd = self._macd(closes[:-1], self.config.macd_fast, self.config.macd_slow, self.config.macd_signal)
            if prev_macd[2] * histogram < 0:  # Sign change = crossover
                strength = min(1.0, strength * 1.5)
        
        return Signal(
            "macd", direction, strength, histogram,
            f"MACD hist={histogram:.2f}, line={macd_line:.2f}"
        )

    def _signal_ema_cross(self, candles: list[Candle]) -> Signal:
        """EMA fast/slow crossover signal."""
        closes = [c.close for c in candles]
        ema_fast = self._ema(closes, self.config.ema_fast)
        ema_slow = self._ema(closes, self.config.ema_slow)
        
        if not ema_fast or not ema_slow:
            return Signal("ema_cross", MarketDirection.HOLD, 0.0, 0.0, "Insufficient data")
        
        current_diff = ema_fast[-1] - ema_slow[-1]
        
        if current_diff > 0:
            direction = MarketDirection.UP
        elif current_diff < 0:
            direction = MarketDirection.DOWN
        else:
            direction = MarketDirection.HOLD
        
        # Strength from spread magnitude
        spread_pct = abs(current_diff) / closes[-1] * 100
        strength = min(1.0, spread_pct / 0.15)
        
        # Check for recent crossover (stronger signal)
        if len(ema_fast) >= 2 and len(ema_slow) >= 2:
            prev_diff = ema_fast[-2] - ema_slow[-2]
            if prev_diff * current_diff < 0:  # Sign change
                strength = min(1.0, strength * 2.0)
        
        return Signal(
            "ema_cross", direction, strength, current_diff,
            f"EMA({self.config.ema_fast}/{self.config.ema_slow}) diff={current_diff:.2f}"
        )

    # ── Master Decision Engine ──────────────────────────────────

    def analyze(self, candles: list[Candle], current_price: float) -> StrategyDecision:
        """
        Run all signals, compute weighted decision.
        
        Args:
            candles: Historical OHLCV candles (15m interval, oldest first)
            current_price: Latest consensus price from oracle
        
        Returns:
            StrategyDecision with direction, confidence, and trade recommendation.
        """
        if len(candles) < 30:
            return StrategyDecision(
                direction=MarketDirection.HOLD,
                confidence=0.0,
                signals=[],
                current_price=current_price,
                volatility_pct=0.0,
                should_trade=False,
                reason="Insufficient candle data (<30)",
                position_size_pct=0.0,
            )

        # ── Volatility Filter ──
        volatility = self._calculate_volatility(candles[-20:])
        if volatility < self.config.min_volatility_pct:
            return StrategyDecision(
                direction=MarketDirection.HOLD,
                confidence=0.0,
                signals=[],
                current_price=current_price,
                volatility_pct=volatility,
                should_trade=False,
                reason=f"Volatility too low ({volatility:.3f}% < {self.config.min_volatility_pct}%)",
                position_size_pct=0.0,
            )
        if volatility > self.config.max_volatility_pct:
            return StrategyDecision(
                direction=MarketDirection.HOLD,
                confidence=0.0,
                signals=[],
                current_price=current_price,
                volatility_pct=volatility,
                should_trade=False,
                reason=f"Volatility too high ({volatility:.3f}% > {self.config.max_volatility_pct}%)",
                position_size_pct=0.0,
            )

        # ── Generate All Signals ──
        signals = [
            self._signal_momentum(candles),
            self._signal_rsi(candles),
            self._signal_macd(candles),
            self._signal_ema_cross(candles),
        ]

        # ── Weighted Score ──
        weights = {
            "momentum": self.config.weight_momentum,
            "rsi": self.config.weight_rsi,
            "macd": self.config.weight_macd,
            "ema_cross": self.config.weight_ema_cross,
        }

        up_score = 0.0
        down_score = 0.0
        for sig in signals:
            w = weights.get(sig.name, 0.0)
            if sig.direction == MarketDirection.UP:
                up_score += sig.strength * w
            elif sig.direction == MarketDirection.DOWN:
                down_score += sig.strength * w
            # HOLD contributes nothing

        total_strength = up_score + down_score
        if total_strength == 0:
            direction = MarketDirection.HOLD
            confidence = 0.0
        elif up_score > down_score:
            direction = MarketDirection.UP
            confidence = up_score / (up_score + down_score) if total_strength > 0 else 0
        else:
            direction = MarketDirection.DOWN
            confidence = down_score / (up_score + down_score) if total_strength > 0 else 0

        # Scale confidence by total signal strength
        confidence *= min(1.0, total_strength / 0.5)

        # ── Trade Decision ──
        should_trade = (
            direction != MarketDirection.HOLD
            and confidence >= self.config.confidence_threshold
        )

        # ── Position Sizing (Kelly-inspired) ──
        if should_trade:
            # f* = (bp - q) / b where b=odds, p=win_prob, q=1-p
            # For binary markets, b ≈ 1 (even money approx)
            win_prob = confidence
            lose_prob = 1 - win_prob
            kelly = win_prob - lose_prob  # Simplified Kelly
            # Apply fractional Kelly for safety
            position_size_pct = max(0, kelly * 100) * 0.25  # Quarter Kelly
            position_size_pct = min(position_size_pct, 10.0)  # Cap at 10%
        else:
            position_size_pct = 0.0

        reason = (
            f"UP={up_score:.3f} DOWN={down_score:.3f} → "
            f"{direction.value} @ {confidence:.2f} confidence"
        )

        decision = StrategyDecision(
            direction=direction,
            confidence=confidence,
            signals=signals,
            current_price=current_price,
            volatility_pct=volatility,
            should_trade=should_trade,
            reason=reason,
            position_size_pct=position_size_pct,
        )

        self._trade_history.append(decision)
        logger.info(f"Strategy: {decision.summary()}")
        return decision

    def get_history(self) -> list[StrategyDecision]:
        return self._trade_history.copy()
