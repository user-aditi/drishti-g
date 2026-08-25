"""Enumerations shared across the domain model.

These are stored as native Postgres enums. Adding a value later needs a
migration (ALTER TYPE ... ADD VALUE), so keep the sets deliberate.
"""
import enum


class UserRole(str, enum.Enum):
    CITIZEN = "citizen"
    FIELD_OFFICIAL = "field_official"
    ADMIN = "admin"


class ComplaintStatus(str, enum.Enum):
    SUBMITTED = "submitted"        # citizen filed it, GCCE not yet done
    ROUTED = "routed"              # GCCE assigned dept + ward
    ASSIGNED = "assigned"          # a field official owns it
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"          # official submitted evidence
    CLOSED = "closed"              # supervisor signed off
    REJECTED = "rejected"
    DUPLICATE = "duplicate"


class Priority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RiskBand(str, enum.Enum):
    LOW = "low"           # 0-39
    MODERATE = "moderate" # 40-59
    HIGH = "high"         # 60-79
    SEVERE = "severe"     # 80-100


class RiskEntityType(str, enum.Enum):
    WARD = "ward"
    CONTRACTOR = "contractor"
    PROJECT = "project"


class ReviewStatus(str, enum.Enum):
    PENDING = "pending"
    ACKNOWLEDGED = "acknowledged"
    ACTIONED = "actioned"
    DISMISSED = "dismissed"
