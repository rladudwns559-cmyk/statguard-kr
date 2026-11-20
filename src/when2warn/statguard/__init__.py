"""StatGuard offline calculation foundation, separate from Agent and web evidence."""
from .core import (
    CONTRACT_VERSION, CalculationResult, CalculationSpec, CsvLimits, NumericClaim,
    StatGuardError, TableDataset, Tolerance, execute, load_csv_bytes, verify_numeric_claim,
)

__all__ = ["CONTRACT_VERSION", "CalculationResult", "CalculationSpec", "CsvLimits", "NumericClaim",
           "StatGuardError", "TableDataset", "Tolerance", "execute", "load_csv_bytes", "verify_numeric_claim"]
