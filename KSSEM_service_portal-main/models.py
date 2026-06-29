from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Complaint(db.Model):
    __tablename__ = "complaints"
    id = db.Column(db.Integer, primary_key=True)
    tracking_id = db.Column(db.String(48), unique=True, nullable=False)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(80), nullable=False, index=True)
    subcategory = db.Column(db.String(80), nullable=True)
    location = db.Column(db.String(200), nullable=True)
    contact = db.Column(db.String(200), nullable=True)
    image_path = db.Column(db.String(300), nullable=True)
    status = db.Column(db.String(40), default="Queued", nullable=False)
    ip = db.Column(db.String(45), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f'<Complaint {self.tracking_id}: {self.title} ({self.status})>'


class BlockedIP(db.Model):
    __tablename__ = 'blocked_ips'
    id = db.Column(db.Integer, primary_key=True)
    ip = db.Column(db.String(45), unique=True, nullable=False)
    reason = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f'<BlockedIP {self.ip}>'


class AdminUser(db.Model):
    __tablename__ = 'admin_users'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    is_confirmed = db.Column(db.Boolean, default=False, nullable=False)
    confirmed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f'<AdminUser {self.email}>'


class ComplaintStatusHistory(db.Model):
    __tablename__ = 'complaint_status_history'
    id = db.Column(db.Integer, primary_key=True)
    complaint_id = db.Column(db.Integer, db.ForeignKey('complaints.id'), nullable=False, index=True)
    status = db.Column(db.String(80), nullable=False)
    changed_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
    actor = db.Column(db.String(255), nullable=True)

    def __repr__(self):
        return f'<ComplaintStatusHistory complaint={self.complaint_id} status={self.status} at={self.changed_at}>'
