import os, io, csv, ipaddress, base64, uuid
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, Response, render_template, redirect, url_for
from flask_cors import CORS
from werkzeug.utils import secure_filename

import config
from models import db, Complaint, BlockedIP, AdminUser, ComplaintStatusHistory
from flask import session
from werkzeug.security import generate_password_hash, check_password_hash
import smtplib
from email.message import EmailMessage
from datetime import timedelta
from sqlalchemy import inspect, func
from sqlalchemy.exc import OperationalError
import pandas as pd

# app init
app = Flask(__name__, template_folder="templates", static_folder="static")
app.config['SQLALCHEMY_DATABASE_URI'] = config.DATABASE_URI
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = config.UPLOAD_FOLDER
app.config['SECRET_KEY'] = config.SECRET_KEY
app.permanent_session_lifetime = timedelta(days=config.SESSION_LIFETIME_DAYS)

db.init_app(app)
CORS(app, supports_credentials=True)

# ensure upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# create tables if not exist
with app.app_context():
    db.create_all()
    # Ensure 'ip' column exists on complaints table (use SQLAlchemy inspector for reliability)
    try:
        inspector = inspect(db.engine)
        cols = [c['name'] for c in inspector.get_columns('complaints')]
        if 'ip' not in cols:
            try:
                db.session.execute("ALTER TABLE complaints ADD COLUMN ip VARCHAR(45)")
                db.session.commit()
                print('Added ip column to complaints table')
            except Exception as e:
                # If ALTER fails, rollback and continue; we'll handle missing column at query time
                db.session.rollback()
                print('Could not add ip column automatically:', e)
    except Exception as e:
        print('Inspector check failed:', e)

# ---------- helpers ----------
def get_client_ip():
    forwarded = request.headers.get('X-Forwarded-For', None)
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.remote_addr


def send_confirmation_email(to_email, subject, body):
    """Try to send an email using SMTP settings in config. If SMTP not configured, log to console."""
    # If SMTP configured, attempt to send. Return True if attempt made successfully, False otherwise.
    if config.SMTP_HOST and config.SMTP_USER and config.SMTP_PASSWORD:
        try:
            msg = EmailMessage()
            msg['Subject'] = subject
            # Prefer to set a friendly From: use SPECIAL_ADMIN_EMAIL if available, otherwise SMTP_USER
            msg['From'] = config.SPECIAL_ADMIN_EMAIL or config.SMTP_USER
            msg['To'] = to_email
            # Also BCC portal address so kssem.service.portal@gmail.com is notified
            if config.SPECIAL_ADMIN_EMAIL:
                msg['Bcc'] = config.SPECIAL_ADMIN_EMAIL
            msg.set_content(body)
            if config.SMTP_USE_TLS:
                server = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT)
                server.starttls()
            else:
                server = smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT)
            server.login(config.SMTP_USER, config.SMTP_PASSWORD)
            server.send_message(msg)
            server.quit()
            return True
        except Exception as e:
            print('Failed to send confirmation email via SMTP:', e)
            # fallthrough to logging

    # Fallback: dump the message to a local log file (so admin can inspect) and print to console
    try:
        os.makedirs(os.path.join(os.path.dirname(__file__), 'logs'), exist_ok=True)
        fname = os.path.join(os.path.dirname(__file__), 'logs', f"email_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.txt")
        with open(fname, 'w', encoding='utf-8') as fh:
            fh.write(f"To: {to_email}\nSubject: {subject}\n\n{body}\n")
        print('SMTP not configured or failed - confirmation email written to', fname)
    except Exception as e:
        print('Failed to write confirmation email to log file:', e)
    print('Confirmation email (fallback) - To:', to_email)
    print('Subject:', subject)
    print(body)
    return False

def ip_in_campus(ip_str):
    try:
        ipaddr = ipaddress.ip_address(ip_str)
    except Exception:
        return False
    for cidr in config.CAMPUS_CIDRS:
        try:
            net = ipaddress.ip_network(cidr.strip())
            if ipaddr in net:
                return True
        except Exception:
            continue
    return False

def campus_required(fn):
    def wrapper(*a, **k):
        ip = get_client_ip() or ""
        if not ip_in_campus(ip):
            return jsonify({"error":"Access allowed only from campus network", "client_ip": ip}), 403
        return fn(*a, **k)
    wrapper.__name__ = fn.__name__
    return wrapper

def make_tracking_id(category):
    # Create category prefix
    prefix = {
        "Maintenance": "MNT",
        "Security": "SEC",
        "Parking": "PRK",
        "Transportation": "TRN",
        "Canteen": "CNT",
        "Library": "LIB",
        "Department": "DPT",
        "Other": "GEN"
    }.get(category, "GEN")
    
    # Get current time components
    timestamp = datetime.utcnow()
    date_part = timestamp.strftime("%y%m%d")  # YYMMDD
    time_part = timestamp.strftime("%H%M")    # HHMM
    
    # Generate random part
    random_part = uuid.uuid4().hex[:4].upper()
    
    # Combine all parts: KSSEM-{CATEGORY}-{YYMMDD}-{HHMM}-{RANDOM}
    return f"KSSEM-{prefix}-{date_part}-{time_part}-{random_part}"

# ---------- web routes for frontend (templates) ----------
@app.route("/")
def home():
    return render_template("index.html")

@app.route("/department")
def department():
    return render_template("department.html")

@app.route("/maintenance")
def maintenance():
    return render_template("maintenance.html")

@app.route("/canteen")
def canteen():
    return render_template("canteen.html")

@app.route("/security")
def security():
    return render_template("security.html")

@app.route("/parking")
def parking():
    return render_template("parking.html")

@app.route("/transportation")
def transportation():
    return render_template("transportation.html")

@app.route("/library")
def library():
    return render_template("library.html")

@app.route("/others")
def others():
    return render_template("others.html")

@app.route("/complaint")
def complaint_form():
    # expects category & optional sub in query params
    return render_template("complaint.html")

@app.route("/complaints")
def complaints_page():
    return render_template("complaints.html")

@app.route("/admin-login")
def admin_login_page():
    # If already logged in for a category, go straight to dashboard
    if session.get('admin_selection'):
        return redirect(url_for('admin_dashboard_page'))
    return render_template("admin-login.html")

@app.route("/admin-dashboard")
def admin_dashboard_page():
    # Only allow access if admin_selection present in session; otherwise redirect to login
    if not session.get('admin_selection'):
        return redirect(url_for('admin_login_page'))
    admin_sel = session.get('admin_selection')
    admin_em = session.get('admin_email')
    print(f"[ADMIN_DASHBOARD] admin_selection = {repr(admin_sel)}, admin_email = {repr(admin_em)}")
    return render_template("admin-dashboard.html", admin_selection=admin_sel, admin_email=admin_em)

@app.route('/about')
def about_page():
    return render_template('about.html')


# ---------- API endpoints ----------
@app.route("/api/health")
def health():
    return jsonify({"status":"ok"})

@app.route("/api/debug/complaint_counts", methods=["GET"])
def debug_complaint_counts():
    """Debug endpoint: show all complaints grouped by category/subcategory"""
    results = db.session.query(
        Complaint.category,
        Complaint.subcategory,
        func.count(Complaint.id).label('count')
    ).group_by(Complaint.category, Complaint.subcategory).all()
    
    output = []
    for cat, sub, cnt in results:
        output.append({
            "category": cat,
            "subcategory": sub,
            "count": cnt
        })
    return jsonify(output)

@app.route("/api/complaints", methods=["POST"])
def create_complaint():
    """
    Accept multipart/form-data or JSON:
    fields: title, description, category, subcategory, location, contact
    image: file upload (field 'image') OR image_base64 in form/json
    """
    # capture client IP and check blocked list
    client_ip = get_client_ip() or None
    blocked = BlockedIP.query.filter_by(ip=client_ip).first()
    if blocked:
        return jsonify({"error":"Your IP is blocked from submitting complaints"}), 403

    # parse fields
    title = request.form.get('title') or (request.json.get('title') if request.is_json else None)
    description = request.form.get('description') or (request.json.get('description') if request.is_json else None)
    category = request.form.get('category') or (request.json.get('category') if request.is_json else None)
    subcategory = request.form.get('subcategory') or (request.json.get('subcategory') if request.is_json else None)
    location = request.form.get('location') or (request.json.get('location') if request.is_json else None)
    contact = request.form.get('contact') or (request.json.get('contact') if request.is_json else None)

    if not title or not description or not category:
        return jsonify({"error":"title, description and category required"}), 400

    image_path = None

    # file upload
    if 'image' in request.files and request.files['image'].filename:
        f = request.files['image']
        fn = secure_filename(f.filename)
        unique = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}_{fn}"
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], unique)
        f.save(save_path)
        image_path = unique
    else:
        # base64 field
        data = None
        if request.is_json:
            data = request.json.get('image_base64')
        else:
            data = request.form.get('image_base64')
        if data:
            if "," in data:
                header, b64 = data.split(",",1)
            else:
                b64 = data
                header = ""
            try:
                binary = base64.b64decode(b64)
                ext = ".png"
                if "jpeg" in header or "jpg" in header: ext = ".jpg"
            except Exception:
                return jsonify({"error":"Invalid base64 image"}), 400
            unique = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}{ext}"
            save_path = os.path.join(app.config['UPLOAD_FOLDER'], unique)
            with open(save_path,"wb") as fh:
                fh.write(binary)
            image_path = unique

    tracking = make_tracking_id(category)
    complaint = Complaint(
        tracking_id=tracking,
        title=title,
        description=description,
        category=category,
        subcategory=subcategory,
        location=location,
        contact=contact,
        image_path=image_path,
        status="Queued",
        ip=client_ip,
        created_at=datetime.utcnow()
    )
    db.session.add(complaint)
    db.session.commit()

    # Record initial status history entry
    try:
        hist = ComplaintStatusHistory(complaint_id=complaint.id, status=complaint.status, changed_at=complaint.created_at, actor=None)
        db.session.add(hist)
        db.session.commit()
    except Exception:
        db.session.rollback()

    return jsonify({
        "id": complaint.id,
        "tracking_id": complaint.tracking_id,
        "status": complaint.status
    }), 201

@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route("/api/user/complaints", methods=["GET"])
def api_user_complaints():
    """Get all complaints for the user to track (no filtering by category)"""
    q = request.args.get("q")
    sort = request.args.get("sort", "created_at")
    
    query = Complaint.query
    
    if q:
        like = f"%{q}%"
        query = query.filter(
            (Complaint.title.ilike(like)) | 
            (Complaint.description.ilike(like)) | 
            (Complaint.tracking_id.ilike(like))
        )
    
    if sort == "status":
        query = query.order_by(Complaint.status, Complaint.created_at.desc())
    else:
        query = query.order_by(Complaint.created_at.desc())
    
    results = []
    try:
        rows = query.all()
    except OperationalError as oe:
        # attempt to repair missing 'ip' column if that's the cause
        msg = str(oe).lower()
        if 'no such column' in msg and 'ip' in msg:
            try:
                inspector = inspect(db.engine)
                cols = [c['name'] for c in inspector.get_columns('complaints')]
                if 'ip' not in cols:
                    db.session.execute("ALTER TABLE complaints ADD COLUMN ip VARCHAR(45)")
                    db.session.commit()
                    rows = query.all()
                else:
                    raise
            except Exception as e:
                return jsonify({"error": f"Database missing column 'ip' and automatic fix failed: {e}"}), 500
        else:
            return jsonify({"error": str(oe)}), 500

    for c in rows:
        results.append({
            "id": c.id,
            "tracking_id": c.tracking_id,
            "title": c.title,
            "description": c.description,
            "category": c.category,
            "subcategory": c.subcategory,
            "location": c.location,
            "contact": c.contact,
            "image_url": (f"/uploads/{c.image_path}" if c.image_path else None),
            "ip": getattr(c, 'ip', None),
            "status": c.status,
            "created_at": c.created_at.isoformat()
        })
    return jsonify(results)

@app.route("/api/admin/login", methods=["POST"])
def api_admin_login():
    body = request.json or {}
    selection = (body.get('selection') or '').strip()
    pwd = body.get('password')
    email = (body.get('email') or '').strip()
    remember = body.get('remember', True)

    if not selection or not pwd or not email:
        return jsonify({"error":"selection, email & password required"}), 400

    # Find matching category key case-insensitively
    found_key = None
    for k in config.ADMIN_PASSWORDS.keys():
        if k.lower() == selection.lower():
            found_key = k
            break

    if not found_key:
        return jsonify({"error":"invalid selection"}), 401

    real = config.ADMIN_PASSWORDS.get(found_key)
    if real and pwd == real:
        # set session for admin selection (store canonical key)
        session['admin_selection'] = found_key
        session['admin_email'] = email
        session.permanent = bool(remember)

        # send confirmation to the provided email (returns True if SMTP sent)
        subject = f'KSSEM Portal: Admin login confirmation'
        body_txt = f'Hello,\n\nYou have successfully logged into the KSSEM Service Portal as {email} for category: {found_key}.\nIf this was not you, please contact support.'
        try:
            sent = send_confirmation_email(email, subject, body_txt)
        except Exception as e:
            print('email send error:', e)
            sent = False
        # Also attempt to send a copy/notification to the portal address (best-effort)
        try:
            if config.SPECIAL_ADMIN_EMAIL and config.SPECIAL_ADMIN_EMAIL != email:
                portal_sub = f'KSSEM Portal: Admin login by {email} for {found_key}'
                portal_body = f'Admin {email} logged in for category {found_key} at {datetime.utcnow().isoformat()} UTC.'
                send_confirmation_email(config.SPECIAL_ADMIN_EMAIL, portal_sub, portal_body)
        except Exception as e:
            print('portal email send error:', e)

        return jsonify({"ok": True, "selection": found_key, "email": email, "email_sent": bool(sent)})

    return jsonify({"error":"invalid password"}), 401


@app.route('/api/admin/logout', methods=['POST'])
def api_admin_logout():
    session.pop('admin_email', None)
    session.pop('admin_selection', None)
    return jsonify({'ok': True})


@app.route('/api/admin/whoami', methods=['GET'])
def api_admin_whoami():
    selection = session.get('admin_selection')
    email = session.get('admin_email')
    if not selection:
        return jsonify({'error':'not logged in'}), 401
    return jsonify({'selection': selection, 'email': email})

@app.route("/api/admin/complaints", methods=["GET"])
def api_admin_list():
    # Prefer explicit query param, fallback to session selection so dashboard JS doesn't have to provide it
    sel = request.args.get("selection") or session.get('admin_selection')
    if not sel:
        return jsonify({"error":"selection required"}), 400
    q = request.args.get("q")
    status = request.args.get("status")
    sort = request.args.get("sort", "created_at_desc")

    query = Complaint.query
    # If selection points to a department subcategory (Department::SUB), filter accordingly
    if sel.startswith("Department::"):
        sub = sel.split("::", 1)[1]
        # match category == 'Department' and subcategory == sub (case-insensitive)
        query = query.filter(Complaint.category == 'Department', func.lower(Complaint.subcategory) == sub.lower())
    else:
        # Match other categories case-insensitively; allow stored category values that might include 'Department::' too
        query = query.filter(func.lower(Complaint.category) == sel.lower())

    if status:
        query = query.filter(Complaint.status==status)
    if q:
        like = f"%{q}%"
        query = query.filter((Complaint.title.ilike(like)) | (Complaint.description.ilike(like)) | (Complaint.tracking_id.ilike(like)))

    # Handle different sort options
    if sort == "status":
        query = query.order_by(Complaint.status, Complaint.created_at.desc())
    elif sort == "created_at_asc":
        query = query.order_by(Complaint.created_at.asc())
    else:  # Default to created_at_desc (Newest)
        query = query.order_by(Complaint.created_at.desc())

    results = []
    try:
        rows = query.all()
    except OperationalError as oe:
        msg = str(oe).lower()
        if 'no such column' in msg and 'ip' in msg:
            try:
                inspector = inspect(db.engine)
                cols = [c['name'] for c in inspector.get_columns('complaints')]
                if 'ip' not in cols:
                    db.session.execute("ALTER TABLE complaints ADD COLUMN ip VARCHAR(45)")
                    db.session.commit()
                    rows = query.all()
                else:
                    raise
            except Exception as e:
                return jsonify({"error": f"Database missing column 'ip' and automatic fix failed: {e}"}), 500
        else:
            return jsonify({"error": str(oe)}), 500

    for c in rows:
        results.append({
            "id": c.id,
            "tracking_id": c.tracking_id,
            "title": c.title,
            "description": c.description,
            "category": c.category,
            "subcategory": c.subcategory,
            "location": c.location,
            "contact": c.contact,
            "image_url": (f"/uploads/{c.image_path}" if c.image_path else None),
            "ip": getattr(c, 'ip', None),
            "status": c.status,
            "created_at": c.created_at.isoformat()
        })
    return jsonify(results)


@app.route("/api/admin/block_ip", methods=["POST"])
def api_admin_block_ip():
    body = request.json or {}
    ip = body.get('ip')
    reason = body.get('reason')
    if not ip:
        return jsonify({"error":"ip required"}), 400
    exists = BlockedIP.query.filter_by(ip=ip).first()
    if exists:
        return jsonify({"ok": True, "blocked": True, "id": exists.id})
    b = BlockedIP(ip=ip, reason=reason, created_at=datetime.utcnow())
    db.session.add(b)
    db.session.commit()
    return jsonify({"ok": True, "blocked": True, "id": b.id})


@app.route("/api/admin/blocked_ips", methods=["GET"])
def api_admin_blocked_list():
    rows = []
    for b in BlockedIP.query.order_by(BlockedIP.created_at.desc()).all():
        rows.append({"id": b.id, "ip": b.ip, "reason": b.reason, "created_at": b.created_at.isoformat()})
    return jsonify(rows)

@app.route("/api/admin/complaints/<int:cid>", methods=["PATCH"])
def api_admin_update_status(cid):
    c = Complaint.query.get_or_404(cid)
    body = request.json or {}
    new_status = body.get('status', '').strip()
    
    if not new_status:
        return jsonify({"error": "status required"}), 400
    
    # Validate status value
    valid_statuses = ['Queued', 'In Progress', 'Solved', 'Rejected']
    if new_status not in valid_statuses:
        return jsonify({"error": f"invalid status. Must be one of: {', '.join(valid_statuses)}"}), 400
    
    # update status and record history
    old = c.status
    c.status = new_status
    try:
        db.session.add(c)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error":"Failed to update status"}), 500

    try:
        actor = session.get('admin_email') if session else None
        hist = ComplaintStatusHistory(complaint_id=c.id, status=new_status, changed_at=datetime.utcnow(), actor=actor)
        db.session.add(hist)
        db.session.commit()
    except Exception:
        db.session.rollback()

    return jsonify({"ok": True, "id": c.id, "status": c.status})


@app.route('/api/complaints/<int:cid>/history', methods=['GET'])
def api_complaint_history(cid):
    # Return chronological history for a complaint (including created event)
    c = Complaint.query.get_or_404(cid)
    rows = ComplaintStatusHistory.query.filter_by(complaint_id=cid).order_by(ComplaintStatusHistory.changed_at.asc()).all()
    if not rows:
        # Fallback: synthesize basic history from created_at and updated_at
        hist = []
        hist.append({"status": "Created", "changed_at": c.created_at.isoformat(), "actor": None})
        hist.append({"status": c.status, "changed_at": (c.updated_at.isoformat() if c.updated_at else c.created_at.isoformat()), "actor": None})
        return jsonify(hist)

    out = []
    for r in rows:
        out.append({"status": r.status, "changed_at": r.changed_at.isoformat(), "actor": r.actor})
    return jsonify(out)

@app.route("/api/admin/complaints/<int:cid>", methods=["DELETE"])
def api_admin_delete(cid):
    c = Complaint.query.get_or_404(cid)
    if c.image_path:
        p = os.path.join(app.config['UPLOAD_FOLDER'], c.image_path)
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass
    db.session.delete(c)
    db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/admin/export.csv", methods=["GET"])
def api_export_csv():
    sel = request.args.get("selection") or session.get('admin_selection')
    if not sel:
        return jsonify({"error":"selection required"}), 400
    query = Complaint.query
    # handle Department::SUB selections and case-insensitive matching
    if sel.startswith("Department::"):
        sub = sel.split("::",1)[1]
        query = query.filter(Complaint.category == 'Department', func.lower(Complaint.subcategory) == sub.lower())
    else:
        query = query.filter(func.lower(Complaint.category) == sel.lower())
    rows = [{
        "tracking_id": c.tracking_id,
        "title": c.title,
        "description": c.description,
        "category": c.category,
        "subcategory": c.subcategory or "",
        "location": c.location or "",
        "contact": c.contact or "",
        "status": c.status,
        "created_at": c.created_at
    } for c in query.all()]
    df = pd.DataFrame(rows)
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    mem = buf.getvalue()
    return Response(mem, mimetype="text/csv",
                    headers={"Content-disposition": f"attachment; filename=complaints_{sel.replace('::','_')}.csv"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
