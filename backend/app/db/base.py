"""Imports every model so Alembic's autogenerate sees the full metadata.

Import this module — never the individual model modules — from alembic/env.py.
"""
from app.db.session import Base  # noqa: F401
from app.models.audit import AuditEvent  # noqa: F401
from app.models.complaint import Complaint, ComplaintStatusHistory  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.org import ComplaintCategory, Department, Ward  # noqa: F401
from app.models.risk import RiskFlag, RiskScore  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.works import Contractor, Inspection, Project  # noqa: F401
