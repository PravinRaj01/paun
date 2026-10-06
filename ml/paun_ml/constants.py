"""Tunables shared across the package. Kept in a leaf module so features / vol / bands can all import
them without circular imports."""

HORIZON = 5  # trading sessions ahead (~7 calendar days)
BURN_IN = 200  # rows at the start where recursions (EWMA/GARCH, 200-day MA) have not settled; never trained on
LABEL_K = 0.75  # regime threshold = LABEL_K x (expected H-session volatility): "unusually large move"
