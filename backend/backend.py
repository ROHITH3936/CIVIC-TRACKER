"""CivicTrack API - authenticated issue reporting and resolution workflow."""
from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import bcrypt
import mysql.connector
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel, EmailStr, Field

APP_DIR = Path(__file__).resolve().parent
load_dotenv(APP_DIR / ".env")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(APP_DIR / "uploads"))).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "7"))

app = FastAPI(title="CivicTrack API", version="2.0.0")
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5500,http://localhost:5500,https://civictracker-ns4y.onrender.com").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
bearer = HTTPBearer(auto_error=False)


def get_db():
    required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]
    missing = [key for key in required if os.getenv(key) is None]
    if missing:
        raise HTTPException(status_code=503, detail="Database configuration is incomplete: " + ", ".join(missing))
    return mysql.connector.connect(host=os.getenv("DB_HOST"), user=os.getenv("DB_USER"), password=os.getenv("DB_PASSWORD"), database=os.getenv("DB_NAME"), autocommit=False)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Please sign in to continue")
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""SELECT u.user_id, u.full_name, u.email, u.role
                       FROM auth_sessions s JOIN users u ON u.user_id=s.user_id
                       WHERE s.token_hash=%s AND s.expires_at > UTC_TIMESTAMP()""", (token_hash(credentials.credentials),))
        user = cur.fetchone()
        cur.close()
        if not user:
            raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again")
        return user
    finally:
        conn.close()


def require_admin(user=Depends(get_current_user)):
    if user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Administrator access is required")
    return user


def notify(cur, user_id: int, issue_id: int | None, message: str):
    cur.execute("INSERT INTO notifications (user_id, issue_id, message) VALUES (%s,%s,%s)", (user_id, issue_id, message))


def save_image(file: UploadFile, subfolder: str) -> tuple[str, str]:
    ext = ALLOWED_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPG, PNG and WebP images are allowed")
    original_ext = Path(file.filename or "").suffix.lower()
    if original_ext and original_ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(status_code=400, detail="Invalid image file extension")
    data = file.file.read(MAX_IMAGE_BYTES + 1)
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image must be between 1 byte and 5 MB")
    # Check actual file signatures rather than trusting the browser MIME type.
    signatures = {".jpg": data.startswith(b"\xff\xd8\xff"), ".png": data.startswith(b"\x89PNG\r\n\x1a\n"), ".webp": len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"}
    if not signatures.get(ext, False):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid image")
    folder = UPLOAD_DIR / subfolder
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    path = folder / filename
    path.write_bytes(data)
    return f"uploads/{subfolder}/{filename}", f"/uploads/{subfolder}/{filename}"


class UserRegister(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone: str = Field(default="", max_length=10)
    password: str = Field(min_length=8, max_length=72)
    address: str = Field(default="", max_length=255)

class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)

class IssueCreate(BaseModel):
    category_id: int
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=12)
    location: str = Field(min_length=3, max_length=255)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "MEDIUM"

class Feedback(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)

class ResolutionReview(BaseModel):
    decision: Literal["CONFIRMED", "DISPUTED"]
    reason: str | None = Field(default=None, max_length=500)


@app.get("/")
def home():
    return {"message": "CivicTrack API is running", "version": "2.0.0"}

@app.post("/register")
def register_user(user: UserRegister):
    conn = get_db()
    try:
        cur = conn.cursor()
        password_hash = bcrypt.hashpw(user.password.encode(), bcrypt.gensalt()).decode()
        cur.execute("INSERT INTO users (full_name,email,phone,password_hash,address) VALUES (%s,%s,%s,%s,%s)", (user.full_name.strip(), user.email.lower(), user.phone.strip(), password_hash, user.address.strip()))
        conn.commit()
        return {"message": "Registration successful", "user_id": cur.lastrowid}
    except mysql.connector.IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail="This email address is already registered")
    finally:
        conn.close()

@app.post("/login")
def login_user(payload: UserLogin):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT user_id,full_name,email,role,password_hash FROM users WHERE email=%s", (payload.email.lower(),))
        row = cur.fetchone()
        if not row or not bcrypt.checkpw(payload.password.encode(), row["password_hash"].encode()):
            raise HTTPException(status_code=401, detail="Email or password is incorrect")
        token = secrets.token_urlsafe(48)
        cur2 = conn.cursor()
        cur2.execute("DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP()")
        cur2.execute("INSERT INTO auth_sessions (user_id,token_hash,expires_at) VALUES (%s,%s,%s)", (row["user_id"], token_hash(token), datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=SESSION_DAYS)))
        conn.commit()
        return {"message": "Login successful", "token": token, "expires_in": SESSION_DAYS * 86400, "user_id": row["user_id"], "full_name": row["full_name"], "email": row["email"], "role": row["role"]}
    finally:
        conn.close()

@app.post("/logout")
def logout(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials:
        conn = get_db()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM auth_sessions WHERE token_hash=%s", (token_hash(credentials.credentials),))
            conn.commit()
        finally:
            conn.close()
    return {"message": "Signed out"}

@app.get("/me")
def me(user=Depends(get_current_user)):
    return {"user_id": user["user_id"], "full_name": user["full_name"], "email": user["email"], "role": user["role"]}

@app.get("/departments")
def get_departments(user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT department_id,department_name,description FROM departments ORDER BY department_name")
        return cur.fetchall()
    finally:
        conn.close()

@app.get("/categories")
def get_categories(user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT c.category_id,c.category_name,c.description,c.department_id,d.department_name FROM categories c LEFT JOIN departments d ON d.department_id=c.department_id ORDER BY c.category_name")
        return cur.fetchall()
    finally:
        conn.close()

@app.post("/issues")
def report_issue(issue: IssueCreate, user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT category_id FROM categories WHERE category_id=%s", (issue.category_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=400, detail="Please select a valid issue category")
        code = "CT" + uuid.uuid4().hex[:8].upper()
        cur.execute("""INSERT INTO issues (issue_code,user_id,category_id,title,description,location,latitude,longitude,priority)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (code,user["user_id"],issue.category_id,issue.title.strip(),issue.description.strip(),issue.location.strip(),issue.latitude,issue.longitude,issue.priority))
        issue_id = cur.lastrowid
        cur.execute("INSERT INTO issue_status_history (issue_id,old_status,new_status,updated_by,remarks) VALUES (%s,NULL,'SUBMITTED',%s,'Complaint submitted')", (issue_id,user["user_id"]))
        conn.commit()
        return {"message":"Complaint submitted successfully","issue_id":issue_id,"complaint_id":code,"status":"SUBMITTED"}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

ISSUE_SELECT = """SELECT i.issue_id,i.issue_code,i.user_id,i.category_id,i.title,i.description,i.location,i.latitude,i.longitude,i.priority,i.status,i.created_at,i.updated_at,c.category_name,d.department_name,
                  (SELECT COUNT(*) FROM issues dup WHERE dup.category_id=i.category_id AND LOWER(dup.location)=LOWER(i.location)) AS similar_reports
                  FROM issues i JOIN categories c ON c.category_id=i.category_id LEFT JOIN departments d ON d.department_id=c.department_id"""

@app.get("/issues")
def get_issues(user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(ISSUE_SELECT + " ORDER BY i.created_at DESC")
        return cur.fetchall()
    finally:
        conn.close()

@app.get("/my/issues")
def get_my_issues(user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(ISSUE_SELECT + " WHERE i.user_id=%s ORDER BY i.created_at DESC", (user["user_id"],))
        return cur.fetchall()
    finally:
        conn.close()

@app.get("/issues/{issue_id}")
def get_issue(issue_id: int, user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(ISSUE_SELECT + " WHERE i.issue_id=%s", (issue_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Complaint not found")
        cur.execute("SELECT image_id, image_path, uploaded_at FROM issue_images WHERE issue_id=%s ORDER BY uploaded_at", (issue_id,))
        row["images"] = [{**x, "image_url": "/" + x["image_path"].replace("\\", "/").lstrip("/")} for x in cur.fetchall()]
        cur.execute("SELECT proof_id,proof_image_path,resolution_description,uploaded_by,uploaded_at FROM resolution_proofs WHERE issue_id=%s ORDER BY uploaded_at DESC LIMIT 1", (issue_id,))
        proof = cur.fetchone()
        if proof:
            proof["image_url"] = "/" + proof["proof_image_path"].replace("\\", "/").lstrip("/")
        row["resolution_proof"] = proof
        cur.execute("SELECT decision,reason,created_at FROM resolution_reviews WHERE issue_id=%s AND user_id=%s", (issue_id,user["user_id"]))
        row["my_resolution_review"] = cur.fetchone() if row["user_id"] == user["user_id"] else None
        return row
    finally:
        conn.close()

@app.post("/issues/{issue_id}/images")
def upload_issue_image(issue_id: int, file: UploadFile = File(...), user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM issues WHERE issue_id=%s", (issue_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Complaint not found")
        if user["role"] != "ADMIN" and row[0] != user["user_id"]:
            raise HTTPException(status_code=403, detail="You can only add photos to your own complaint")
        rel, url = save_image(file, "issues")
        cur.execute("INSERT INTO issue_images (issue_id,image_path) VALUES (%s,%s)", (issue_id,rel))
        conn.commit()
        return {"message":"Image uploaded successfully","image_url":url}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

@app.patch("/issues/{issue_id}/department")
def assign_department(issue_id: int, department_id: int, user=Depends(require_admin)):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT status,user_id FROM issues WHERE issue_id=%s", (issue_id,))
        issue = cur.fetchone()
        if not issue:
            raise HTTPException(status_code=404, detail="Complaint not found")
        cur.execute("SELECT department_id FROM departments WHERE department_id=%s", (department_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=400, detail="Invalid department")
        cur.execute("INSERT INTO issue_assignments (issue_id,department_id,assigned_by) VALUES (%s,%s,%s)", (issue_id,department_id,user["user_id"]))
        old = issue[0]
        cur.execute("UPDATE issues SET status='ASSIGNED' WHERE issue_id=%s", (issue_id,))
        cur.execute("INSERT INTO issue_status_history (issue_id,old_status,new_status,updated_by,remarks) VALUES (%s,%s,'ASSIGNED',%s,'Department assigned')", (issue_id,old,user["user_id"]))
        notify(cur, issue[1], issue_id, "Your complaint has been assigned to a department.")
        conn.commit()
        return {"message":"Department assigned successfully","issue_id":issue_id,"department_id":department_id,"status":"ASSIGNED"}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

@app.post("/issues/{issue_id}/resolution-proof")
def upload_resolution_proof(issue_id: int, description: str = Form(...), file: UploadFile = File(...), user=Depends(require_admin)):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id,status FROM issues WHERE issue_id=%s", (issue_id,))
        issue = cur.fetchone()
        if not issue:
            raise HTTPException(status_code=404, detail="Complaint not found")
        rel, url = save_image(file, "resolution_proofs")
        cur.execute("INSERT INTO resolution_proofs (issue_id,proof_image_path,resolution_description,uploaded_by) VALUES (%s,%s,%s,%s)", (issue_id,rel,description.strip(),user["user_id"]))
        conn.commit()
        return {"message":"Resolution photo uploaded successfully","image_url":url}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

@app.patch("/issues/{issue_id}/status")
def update_status(issue_id: int, status: Literal["SUBMITTED","UNDER_REVIEW","ASSIGNED","IN_PROGRESS","RESOLVED","CLOSED","REJECTED"], remarks: str = "Status updated", user=Depends(require_admin)):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT status,user_id FROM issues WHERE issue_id=%s", (issue_id,))
        issue = cur.fetchone()
        if not issue:
            raise HTTPException(status_code=404, detail="Complaint not found")
        if status == "RESOLVED":
            cur.execute("""SELECT proof_id FROM resolution_proofs
                           WHERE issue_id=%s AND uploaded_by=%s
                             AND uploaded_at >= (SELECT updated_at FROM issues WHERE issue_id=%s)
                           ORDER BY uploaded_at DESC LIMIT 1""", (issue_id,user["user_id"],issue_id))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="Upload a new completion photo before marking this complaint as resolved")
            # A new resolution claim requires a fresh citizen review.
            cur.execute("DELETE FROM resolution_reviews WHERE issue_id=%s", (issue_id,))
        if status == "CLOSED":
            cur.execute("SELECT review_id FROM resolution_reviews WHERE issue_id=%s AND decision='CONFIRMED' LIMIT 1", (issue_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="The citizen must confirm the resolution before the complaint can be closed")
        old = issue[0]
        cur.execute("UPDATE issues SET status=%s WHERE issue_id=%s", (status,issue_id))
        cur.execute("INSERT INTO issue_status_history (issue_id,old_status,new_status,updated_by,remarks) VALUES (%s,%s,%s,%s,%s)", (issue_id,old,status,user["user_id"],remarks[:500]))
        msg = "The department has marked your complaint as resolved. Please review the completion photo and confirm whether the issue is fixed." if status == "RESOLVED" else "Your complaint status has been updated to " + status.replace("_", " ")
        notify(cur,issue[1],issue_id,msg)
        conn.commit()
        return {"message":"Status updated successfully","status":status}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

@app.post("/issues/{issue_id}/resolution-review")
def review_resolution(issue_id: int, review: ResolutionReview, user=Depends(get_current_user)):
    if review.decision == "DISPUTED" and not (review.reason and review.reason.strip()):
        raise HTTPException(status_code=400, detail="Please explain why you believe the issue is not resolved")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id,status FROM issues WHERE issue_id=%s", (issue_id,))
        issue = cur.fetchone()
        if not issue:
            raise HTTPException(status_code=404, detail="Complaint not found")
        if issue[0] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Only the citizen who submitted this complaint can review its resolution")
        if issue[1] != "RESOLVED":
            raise HTTPException(status_code=409, detail="This complaint is not awaiting resolution confirmation")
        cur.execute("SELECT proof_id FROM resolution_proofs WHERE issue_id=%s LIMIT 1", (issue_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=409, detail="No completion photo is available to review")
        cur.execute("INSERT INTO resolution_reviews (issue_id,user_id,decision,reason) VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE decision=VALUES(decision),reason=VALUES(reason),created_at=CURRENT_TIMESTAMP", (issue_id,user["user_id"],review.decision,(review.reason or "").strip() or None))
        if review.decision == "DISPUTED":
            cur.execute("UPDATE issues SET status='IN_PROGRESS' WHERE issue_id=%s", (issue_id,))
            cur.execute("INSERT INTO issue_status_history (issue_id,old_status,new_status,updated_by,remarks) VALUES (%s,'RESOLVED','IN_PROGRESS',%s,%s)", (issue_id,user["user_id"],"Citizen disputed resolution: " + (review.reason or "")[:450]))
            cur.execute("SELECT user_id FROM users WHERE role='ADMIN'")
            for admin_row in cur.fetchall():
                notify(cur,admin_row[0],issue_id,"A citizen disputed the resolution of complaint #" + str(issue_id) + ". Reason: " + (review.reason or "")[:350])
            notify(cur,user["user_id"],issue_id,"Your dispute has been sent to the administration. The complaint has been reopened for review.")
        else:
            cur.execute("UPDATE issues SET status='CLOSED' WHERE issue_id=%s", (issue_id,))
            cur.execute("INSERT INTO issue_status_history (issue_id,old_status,new_status,updated_by,remarks) VALUES (%s,'RESOLVED','CLOSED',%s,'Citizen confirmed the resolution')", (issue_id,user["user_id"]))
            notify(cur,user["user_id"],issue_id,"Thank you for confirming that the issue has been resolved. The complaint is now closed.")
        conn.commit()
        return {"message":"Your response has been recorded","decision":review.decision,"status":"IN_PROGRESS" if review.decision=="DISPUTED" else "CLOSED"}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

@app.get("/issues/{issue_id}/history")
def get_history(issue_id: int, user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT old_status,new_status,updated_by,remarks,updated_at FROM issue_status_history WHERE issue_id=%s ORDER BY history_id", (issue_id,))
        return cur.fetchall()
    finally:
        conn.close()

@app.get("/unresolved")
def unresolved_issues(user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(ISSUE_SELECT + " WHERE i.status NOT IN ('RESOLVED','CLOSED','REJECTED') ORDER BY i.created_at DESC")
        return cur.fetchall()
    finally:
        conn.close()

@app.get("/dashboard")
def dashboard(user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""SELECT COUNT(*) total_complaints,
          SUM(status IN ('SUBMITTED','UNDER_REVIEW','ASSIGNED')) pending,
          SUM(status='IN_PROGRESS') in_progress,
          SUM(status IN ('RESOLVED','CLOSED')) resolved,
          SUM(status NOT IN ('RESOLVED','CLOSED','REJECTED')) unresolved FROM issues""")
        row = cur.fetchone()
        return {k:int(v or 0) for k,v in row.items()}
    finally:
        conn.close()

@app.post("/issues/{issue_id}/feedback")
def submit_feedback(issue_id: int, feedback: Feedback, user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id,status FROM issues WHERE issue_id=%s", (issue_id,))
        issue = cur.fetchone()
        if not issue:
            raise HTTPException(status_code=404, detail="Complaint not found")
        if issue[0] != user["user_id"]:
            raise HTTPException(status_code=403, detail="You can only submit feedback for your own complaint")
        if issue[1] != "RESOLVED":
            raise HTTPException(status_code=409, detail="Feedback is available after the complaint is resolved")
        cur.execute("INSERT INTO feedback (issue_id,user_id,rating,comment) VALUES (%s,%s,%s,%s)", (issue_id,user["user_id"],feedback.rating,feedback.comment))
        conn.commit()
        return {"message":"Feedback submitted successfully","issue_id":issue_id}
    except mysql.connector.IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail="Feedback has already been submitted")
    finally:
        conn.close()

@app.get("/users/{user_id}/notifications")
def get_notifications(user_id: int, user=Depends(get_current_user)):
    if user_id != user["user_id"] and user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="You cannot view another user's notifications")
    conn = get_db()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT notification_id,issue_id,message,is_read,created_at FROM notifications WHERE user_id=%s ORDER BY created_at DESC", (user_id,))
        return cur.fetchall()
    finally:
        conn.close()

@app.patch("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, user=Depends(get_current_user)):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE notifications SET is_read=TRUE WHERE notification_id=%s AND user_id=%s", (notification_id,user["user_id"]))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        conn.commit()
        return {"message":"Notification marked as read"}
    finally:
        conn.close()
