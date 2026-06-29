import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Example campus CIDRs - replace with your real campus public IP ranges
CAMPUS_CIDRS = os.getenv("CAMPUS_CIDRS", "203.0.113.0/24,198.51.100.0/24").split(",")

UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", os.path.join(BASE_DIR, "uploads"))
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

DATABASE_URI = os.getenv("DATABASE_URI", "sqlite:///" + os.path.join(BASE_DIR, "kssem.db"))
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-me")

# Demo admin passwords (frontend and backend check)

ADMIN_PASSWORDS = {
    "Maintenance": os.getenv("MAINT_PASSWORD"),
    "Security": os.getenv("SECURITY_PASSWORD"),
    "Parking": os.getenv("PARKING_PASSWORD"),
    "Transportation": os.getenv("TRANSPORT_PASSWORD"),
    "Canteen": os.getenv("CANTEEN_PASSWORD"),
    "Library": os.getenv("LIB_PASSWORD"),
    "Other": os.getenv("OTHER_PASSWORD"),
    "Department::CSE": os.getenv("CSE_PASSWORD"),
    "Department::ECE": os.getenv("ECE_PASSWORD"),
    "Department::AIDS": os.getenv("AIDS_PASSWORD"),
    "Department::MECH": os.getenv("MECH_PASSWORD"),
    "Department::CIVIL": os.getenv("CIVIL_PASSWORD"),
    "Department::CSBS": os.getenv("CSBS_PASSWORD"),
}

# Admin bootstrap account and SMTP settings for confirmation emails
SPECIAL_ADMIN_EMAIL = os.getenv('SPECIAL_ADMIN_EMAIL', 'kssem.service.portal@gmail.com')
SPECIAL_ADMIN_PASSWORD = os.getenv('SPECIAL_ADMIN_PASSWORD', 'change-this-to-secure-pass')

# SMTP settings (optional) - if not provided, server will log the confirmation instead
SMTP_HOST = os.getenv('SMTP_HOST', '')
SMTP_PORT = int(os.getenv('SMTP_PORT', '587') or 587)
SMTP_USER = os.getenv('SMTP_USER', '')
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
SMTP_USE_TLS = os.getenv('SMTP_USE_TLS', '1') == '1'



# Session lifetime (days) for admin persistent login
SESSION_LIFETIME_DAYS = int(os.getenv('SESSION_LIFETIME_DAYS', '30'))
