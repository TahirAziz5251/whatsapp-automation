import uuid
from datetime import datetime, date, time, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Date, Time, Numeric, Integer, Text, ForeignKey, ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base

class ClinicDoctor(Base):
    __tablename__ = "clinic_doctors"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    specialty = Column(String(100), nullable=False)
    qualification = Column(String(100), nullable=True)
    fee_pkr = Column(Numeric(10, 2), nullable=False, default=0.00)
    room_number = Column(String(30), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    schedules = relationship("ClinicDoctorSchedule", back_populates="doctor", cascade="all, delete-orphan")
    appointments = relationship("ClinicAppointment", back_populates="doctor")

class ClinicDoctorSchedule(Base):
    __tablename__ = "clinic_doctor_schedules"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id = Column(UUID(as_uuid=True), nullable=False)
    day_of_week = Column(String(20), nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    slot_duration_minutes = Column(Integer, default=15)
    max_patients_per_session = Column(Integer, default=30)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "doctor_id"],
            ["clinic_doctors.tenant_id", "clinic_doctors.id"],
            ondelete="CASCADE"
        ),
    )

    doctor = relationship("ClinicDoctor", back_populates="schedules")

class ClinicAppointment(Base):
    __tablename__ = "clinic_appointments"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    appointment_number = Column(String(50), nullable=False)
    contact_id = Column(UUID(as_uuid=True), nullable=False)
    doctor_id = Column(UUID(as_uuid=True), nullable=False)
    appointment_date = Column(Date, nullable=False)
    slot_time = Column(Time, nullable=False)
    symptoms = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="BOOKED")
    queue_token = Column(String(30), nullable=False)
    cancellation_reason = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    reminder_24h_sent = Column(Boolean, default=False)
    reminder_24h_sent_at = Column(DateTime(timezone=True), nullable=True)
    reminder_2h_sent = Column(Boolean, default=False)
    reminder_2h_sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("tenant_id", "appointment_number", name="uq_tenant_appointment_num"),
        ForeignKeyConstraint(
            ["tenant_id", "contact_id"],
            ["platform_contacts.tenant_id", "platform_contacts.id"],
            ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "doctor_id"],
            ["clinic_doctors.tenant_id", "clinic_doctors.id"],
            ondelete="RESTRICT"
        ),
    )

    doctor = relationship("ClinicDoctor", back_populates="appointments")

class ClinicLiveQueue(Base):
    __tablename__ = "clinic_live_queues"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id = Column(UUID(as_uuid=True), nullable=False)
    queue_date = Column(Date, nullable=False, default=date.today)
    current_serving_token = Column(String(30), nullable=True)
    current_serving_appointment_id = Column(UUID(as_uuid=True), nullable=True)
    total_booked = Column(Integer, default=0)
    total_checked_in = Column(Integer, default=0)
    total_completed = Column(Integer, default=0)
    estimated_wait_minutes_per_patient = Column(Integer, default=15)
    status = Column(String(20), default="ACTIVE")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("tenant_id", "doctor_id", "queue_date", name="uq_tenant_doctor_queue_date"),
        ForeignKeyConstraint(
            ["tenant_id", "doctor_id"],
            ["clinic_doctors.tenant_id", "clinic_doctors.id"],
            ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "current_serving_appointment_id"],
            ["clinic_appointments.tenant_id", "clinic_appointments.id"],
            ondelete="SET NULL"
        ),
    )
