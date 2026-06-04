"""
Generate a professional academic PDF of all FederCare database tables.

FederCare: AI Health Network — Database Design Document
Mar Thoma Institute of Information Technology, Ayur

Usage:
    cd backend
    python generate_tables_pdf.py

Output:
    federcare_database_tables.pdf
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle,
    Paragraph, Spacer, PageBreak
)
from reportlab.lib.styles import (
    getSampleStyleSheet, ParagraphStyle
)
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT


# ─── Colours ──────────────────────────────────────────────────────────────────
HEADER_BG = colors.HexColor('#E8F0FE')
ROW_ALT_BG = colors.HexColor('#F8F9FA')
BORDER = colors.black
BRAND = colors.HexColor('#1A3C6E')

OUTPUT_FILE = 'federcare_database_tables.pdf'


# ─── Table data — all 41 tables ───────────────────────────────────────────────
# Each entry: (table_name, description, [ [attribute, data_type, constraints, description], ... ])
TABLES = [
    ("login_credentials",
     "Stores login credentials and authentication details for all system users.",
     [
        ["login_id", "UUID", "Primary Key, Not Null", "Unique login identifier"],
        ["email", "Varchar(100)", "Unique, Not Null", "User email address"],
        ["password_hash", "Varchar(255)", "Not Null", "Encrypted password hash"],
        ["role", "Varchar(40)", "Not Null", "User role (super_admin/hospital_admin/doctor/patient/pharmacist/lab_tech/driver/vendor)"],
        ["is_active", "Boolean", "Not Null", "Account active status"],
        ["is_approved", "Boolean", "Not Null", "Account approval status"],
        ["last_login", "DateTime", "Null", "Last login timestamp"],
        ["login_attempts", "Integer", "Not Null", "Failed login attempts count"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("super_admin",
     "Stores super administrator profile details.",
     [
        ["admin_id", "UUID", "Primary Key, Not Null", "Unique admin identifier"],
        ["login_id", "UUID", "Unique, FK to login_credentials", "Reference to login credentials"],
        ["full_name", "Varchar(100)", "Not Null", "Administrator full name"],
        ["phone", "Varchar(15)", "Not Null", "Contact phone number"],
        ["profile_photo", "Varchar(500)", "Not Null", "Profile photo URL"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("role_permissions",
     "Stores module-level permissions for each user role.",
     [
        ["permission_id", "UUID", "Primary Key, Not Null", "Unique permission identifier"],
        ["role", "Varchar(40)", "Not Null", "User role name"],
        ["module", "Varchar(50)", "Not Null", "System module name"],
        ["can_read", "Boolean", "Not Null", "Read permission flag"],
        ["can_write", "Boolean", "Not Null", "Write permission flag"],
        ["can_delete", "Boolean", "Not Null", "Delete permission flag"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
     ]),
    ("login_sessions",
     "Tracks active login sessions and JWT tokens for security.",
     [
        ["session_id", "UUID", "Primary Key, Not Null", "Unique session identifier"],
        ["login_id", "UUID", "FK to login_credentials", "Reference to user login"],
        ["jwt_token_hash", "Varchar(255)", "Not Null", "Hashed JWT token"],
        ["device_info", "Text", "Not Null", "Client device information"],
        ["ip_address", "GenericIP", "Null", "Client IP address"],
        ["expires_at", "DateTime", "Not Null", "Session expiry timestamp"],
        ["created_at", "DateTime", "Not Null", "Session creation timestamp"],
     ]),
    ("audit_logs",
     "Records all system actions for security and compliance auditing.",
     [
        ["log_id", "UUID", "Primary Key, Not Null", "Unique log identifier"],
        ["login_id", "UUID", "FK to login_credentials, Null", "User who performed action"],
        ["action", "Varchar(255)", "Not Null", "Action performed"],
        ["module", "Varchar(50)", "Not Null", "Module where action occurred"],
        ["entity_type", "Varchar(50)", "Not Null", "Type of entity affected"],
        ["entity_id", "UUID", "Null", "ID of affected entity"],
        ["old_value", "JSON", "Null", "Previous value before change"],
        ["new_value", "JSON", "Null", "New value after change"],
        ["ip_address", "GenericIP", "Null", "IP address of request"],
        ["logged_at", "DateTime", "Not Null", "Action timestamp"],
     ]),
    ("notifications",
     "Stores system notifications sent to users across all roles.",
     [
        ["notif_id", "UUID", "Primary Key, Not Null", "Unique notification identifier"],
        ["login_id", "UUID", "FK to login_credentials", "Recipient user reference"],
        ["title", "Varchar(200)", "Not Null", "Notification title"],
        ["message", "Text", "Not Null", "Notification message content"],
        ["notif_type", "Varchar(30)", "Not Null", "Notification type (order/emergency/alert)"],
        ["is_read", "Boolean", "Not Null", "Read status flag"],
        ["related_id", "UUID", "Null", "Related entity identifier"],
        ["created_at", "DateTime", "Not Null", "Notification creation timestamp"],
     ]),
    ("hospital_registrations",
     "Stores hospital registration and profile information.",
     [
        ["hospital_id", "UUID", "Primary Key, Not Null", "Unique hospital identifier"],
        ["login_id", "UUID", "Unique, FK to login_credentials", "Reference to login credentials"],
        ["hospital_name", "Varchar(200)", "Not Null", "Official hospital name"],
        ["registration_no", "Varchar(100)", "Unique, Not Null", "Government registration number"],
        ["address", "Text", "Not Null", "Hospital address"],
        ["city", "Varchar(100)", "Not Null", "City name"],
        ["state", "Varchar(100)", "Not Null", "State name"],
        ["latitude", "Decimal(9,7)", "Null", "GPS latitude coordinate"],
        ["longitude", "Decimal(9,7)", "Null", "GPS longitude coordinate"],
        ["contact_phone", "Varchar(15)", "Not Null", "Hospital contact number"],
        ["contact_email", "Varchar(100)", "Not Null", "Hospital contact email"],
        ["doc_url", "Varchar(500)", "Not Null", "Registration document URL"],
        ["telemedicine_enabled", "Boolean", "Not Null", "Telemedicine support flag"],
        ["approval_status", "Varchar(20)", "Not Null", "Approval status (pending/approved/rejected)"],
        ["profile_photo", "Varchar(500)", "Not Null", "Hospital photo URL"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("departments",
     "Stores hospital department information.",
     [
        ["dept_id", "UUID", "Primary Key, Not Null", "Unique department identifier"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Parent hospital reference"],
        ["dept_name", "Varchar(100)", "Not Null", "Department name"],
        ["description", "Text", "Not Null", "Department description"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
     ]),
    ("beds",
     "Stores hospital bed information and availability status.",
     [
        ["bed_id", "UUID", "Primary Key, Not Null", "Unique bed identifier"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Parent hospital reference"],
        ["bed_type", "Varchar(50)", "Not Null", "Bed type (general/ICU/emergency)"],
        ["ward_name", "Varchar(100)", "Not Null", "Ward name"],
        ["status", "Varchar(20)", "Not Null", "Bed status (available/occupied/reserved)"],
        ["reserved_for", "UUID", "FK to patient_registrations, Null", "Reserved patient reference"],
        ["reserved_at", "DateTime", "Null", "Reservation timestamp"],
        ["admitted_at", "DateTime", "Null", "Patient admission timestamp"],
        ["updated_at", "DateTime", "Not Null", "Last update timestamp"],
     ]),
    ("hospital_inventory",
     "Tracks medical equipment and supply inventory for hospitals.",
     [
        ["inventory_id", "UUID", "Primary Key, Not Null", "Unique inventory identifier"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Parent hospital reference"],
        ["item_name", "Varchar(200)", "Not Null", "Item name"],
        ["category", "Varchar(50)", "Not Null", "Item category"],
        ["quantity", "Integer", "Not Null", "Available quantity"],
        ["unit", "Varchar(20)", "Not Null", "Unit of measurement"],
        ["reorder_level", "Integer", "Not Null", "Minimum reorder threshold"],
        ["last_restocked", "DateTime", "Null", "Last restock timestamp"],
        ["maintenance_due", "Date", "Null", "Next maintenance date"],
     ]),
    ("hospital_patients",
     "Stores patient records added by hospitals for federated learning training data.",
     [
        ["patient_id", "UUID", "Primary Key, Not Null", "Unique record identifier"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Parent hospital reference"],
        ["added_by", "UUID", "FK to login_credentials, Null", "Staff who added record"],
        ["full_name", "Varchar(100)", "Not Null", "Patient full name"],
        ["age", "Integer", "Not Null", "Patient age"],
        ["gender", "Varchar(10)", "Not Null", "Patient gender"],
        ["blood_group", "Varchar(5)", "Not Null", "Patient blood group"],
        ["symptoms", "JSON", "Not Null", "Symptoms list"],
        ["diagnosis", "Varchar(200)", "Not Null", "Medical diagnosis"],
        ["visit_date", "Date", "Not Null", "Hospital visit date"],
        ["notes", "Text", "Not Null", "Clinical notes"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
     ]),
    ("patient_registrations",
     "Stores registered patient profile and health information.",
     [
        ["patient_id", "UUID", "Primary Key, Not Null", "Unique patient identifier"],
        ["login_id", "UUID", "Unique, FK to login_credentials", "Reference to login credentials"],
        ["full_name", "Varchar(100)", "Not Null", "Patient full name"],
        ["dob", "Date", "Not Null", "Date of birth"],
        ["gender", "Varchar(10)", "Not Null", "Patient gender"],
        ["blood_group", "Varchar(5)", "Not Null", "Blood group"],
        ["height_cm", "Decimal", "Null", "Height in centimeters"],
        ["weight_kg", "Decimal", "Null", "Weight in kilograms"],
        ["bmi", "Decimal", "Null", "Body Mass Index"],
        ["address", "Text", "Not Null", "Residential address"],
        ["emergency_contact", "Varchar(15)", "Not Null", "Emergency contact number"],
        ["qr_code_url", "Varchar(500)", "Not Null", "EHR QR code URL"],
        ["lifestyle_data", "JSON", "Not Null", "Lifestyle and health habits data"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("ehr_records",
     "Stores Electronic Health Records for patients.",
     [
        ["record_id", "UUID", "Primary Key, Not Null", "Unique record identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["added_by", "UUID", "FK to login_credentials, Null", "Staff who added record"],
        ["record_type", "Varchar(50)", "Not Null", "Record type (prescription/lab/diagnosis)"],
        ["title", "Varchar(200)", "Not Null", "Record title"],
        ["content", "Text", "Not Null", "Record content"],
        ["file_url", "Varchar(500)", "Not Null", "Attached file URL"],
        ["is_sensitive", "Boolean", "Not Null", "Sensitive data flag"],
        ["recorded_at", "DateTime", "Not Null", "Record timestamp"],
     ]),
    ("allergies",
     "Stores patient allergy information for medical safety.",
     [
        ["allergy_id", "UUID", "Primary Key, Not Null", "Unique allergy identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["allergen", "Varchar(100)", "Not Null", "Allergen name"],
        ["reaction", "Text", "Not Null", "Reaction description"],
        ["severity", "Varchar(20)", "Not Null", "Severity level (mild/moderate/severe)"],
        ["noted_by", "UUID", "FK to doctor_registrations, Null", "Doctor who noted allergy"],
        ["noted_at", "DateTime", "Not Null", "Date allergy was noted"],
     ]),
    ("ehr_consent_log",
     "Tracks patient consent for EHR data access by doctors.",
     [
        ["consent_id", "UUID", "Primary Key, Not Null", "Unique consent identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["accessed_by", "UUID", "FK to login_credentials", "Staff who accessed EHR"],
        ["access_type", "Varchar(50)", "Not Null", "Access type (view/download)"],
        ["data_shared", "JSON", "Not Null", "List of shared data fields"],
        ["consent_given", "Boolean", "Not Null", "Consent status flag"],
        ["expires_at", "DateTime", "Null", "Consent expiry timestamp"],
        ["accessed_at", "DateTime", "Not Null", "Access timestamp"],
     ]),
    ("risk_assessments",
     "Stores AI-generated health risk assessment results for patients.",
     [
        ["risk_id", "UUID", "Primary Key, Not Null", "Unique assessment identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["diabetes_risk", "Decimal", "Null", "Diabetes risk percentage"],
        ["heart_risk", "Decimal", "Null", "Heart disease risk percentage"],
        ["hypertension_risk", "Decimal", "Null", "Hypertension risk percentage"],
        ["risk_level", "Varchar(20)", "Not Null", "Overall risk level (low/medium/high)"],
        ["recommendations", "Text", "Not Null", "AI recommendations"],
        ["alert_sent", "Boolean", "Not Null", "Alert notification sent flag"],
        ["assessed_at", "DateTime", "Not Null", "Assessment timestamp"],
     ]),
    ("patient_complaints",
     "Stores patient complaints about doctors, hospitals or vendors.",
     [
        ["complaint_id", "UUID", "Primary Key, Not Null", "Unique complaint identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Complainant patient reference"],
        ["complaint_type", "Varchar(30)", "Not Null", "Complaint type (doctor/vendor/hospital)"],
        ["doctor_id", "UUID", "FK to doctor_registrations, Null", "Complained doctor reference"],
        ["hospital_id", "UUID", "FK to hospital_registrations, Null", "Complained hospital reference"],
        ["vendor_id", "UUID", "FK to vendor_registrations, Null", "Complained vendor reference"],
        ["subject", "Varchar(200)", "Not Null", "Complaint subject"],
        ["description", "Text", "Not Null", "Detailed complaint description"],
        ["status", "Varchar(20)", "Not Null", "Status (pending/reviewed/resolved)"],
        ["admin_response", "Text", "Not Null", "Admin response to complaint"],
        ["created_at", "DateTime", "Not Null", "Complaint submission timestamp"],
        ["updated_at", "DateTime", "Not Null", "Last update timestamp"],
     ]),
    ("lab_test_orders",
     "Stores patient lab test bookings and results.",
     [
        ["order_id", "UUID", "Primary Key, Not Null", "Unique order identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["hospital_id", "UUID", "FK to hospital_registrations, Null", "Hospital reference"],
        ["doctor_id", "UUID", "FK to doctor_registrations, Null", "Referring doctor reference"],
        ["tests", "JSON", "Not Null", "List of ordered tests"],
        ["total_fee", "Decimal", "Not Null", "Total test fee"],
        ["appointment_date", "Date", "Null", "Scheduled appointment date"],
        ["appointment_time", "Time", "Null", "Scheduled appointment time"],
        ["status", "Varchar(20)", "Not Null", "Order status"],
        ["payment_status", "Varchar(20)", "Not Null", "Payment status"],
        ["razorpay_order_id", "Varchar(100)", "Not Null", "Razorpay order ID"],
        ["razorpay_payment_id", "Varchar(100)", "Not Null", "Razorpay payment ID"],
        ["report_url", "Varchar(500)", "Not Null", "Lab report URL"],
        ["report_results", "JSON", "Not Null", "Test results data"],
        ["abnormal_flags", "JSON", "Not Null", "Abnormal result flags"],
        ["notes", "Text", "Not Null", "Additional notes"],
        ["ordered_at", "DateTime", "Not Null", "Order creation timestamp"],
     ]),
    ("ehr_images",
     "Stores medical images uploaded to patient EHR wallet.",
     [
        ["image_id", "UUID", "Primary Key, Not Null", "Unique image identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["image_type", "Varchar(30)", "Not Null", "Image type (X-Ray/MRI/CT/Ultrasound)"],
        ["image_url", "Varchar(500)", "Not Null", "Image storage URL"],
        ["title", "Varchar(200)", "Not Null", "Image title"],
        ["description", "Text", "Not Null", "Image description"],
        ["hospital_name", "Varchar(200)", "Not Null", "Hospital where scan was done"],
        ["scan_date", "Date", "Null", "Date of scan"],
        ["uploaded_by", "UUID", "FK to login_credentials, Null", "Uploader reference"],
        ["uploaded_at", "DateTime", "Not Null", "Upload timestamp"],
     ]),
    ("doctor_registrations",
     "Stores registered doctor profile and professional details.",
     [
        ["doctor_id", "UUID", "Primary Key, Not Null", "Unique doctor identifier"],
        ["login_id", "UUID", "Unique, FK to login_credentials", "Reference to login credentials"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Associated hospital reference"],
        ["dept_id", "UUID", "FK to departments, Null", "Department reference"],
        ["full_name", "Varchar(100)", "Not Null", "Doctor full name"],
        ["specialization", "Varchar(100)", "Not Null", "Medical specialization"],
        ["license_no", "Varchar(50)", "Unique, Not Null", "Medical license number"],
        ["experience_years", "Integer", "Not Null", "Years of experience"],
        ["consultation_fee", "Decimal", "Not Null", "Consultation fee amount"],
        ["profile_photo", "Varchar(500)", "Not Null", "Profile photo URL"],
        ["is_online", "Boolean", "Not Null", "Online availability status"],
        ["approval_status", "Varchar(20)", "Not Null", "Account approval status"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("doctor_slots",
     "Stores doctor consultation time slots for appointment booking.",
     [
        ["slot_id", "UUID", "Primary Key, Not Null", "Unique slot identifier"],
        ["doctor_id", "UUID", "FK to doctor_registrations", "Doctor reference"],
        ["slot_date", "Date", "Not Null", "Appointment date"],
        ["start_time", "Time", "Not Null", "Slot start time"],
        ["end_time", "Time", "Not Null", "Slot end time"],
        ["consult_type", "Varchar(20)", "Not Null", "Consultation type (online/offline)"],
        ["is_booked", "Boolean", "Not Null", "Booking status flag"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
     ]),
    ("consultations",
     "Stores patient-doctor consultation records including video call details.",
     [
        ["consultation_id", "UUID", "Primary Key, Not Null", "Unique consultation identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["doctor_id", "UUID", "FK to doctor_registrations", "Doctor reference"],
        ["slot_id", "UUID", "FK to doctor_slots, Null", "Booked slot reference"],
        ["jitsi_room_id", "Varchar(200)", "Not Null", "Jitsi Meet room identifier"],
        ["status", "Varchar(20)", "Not Null", "Status (scheduled/active/completed/cancelled)"],
        ["ai_suggestions", "JSON", "Not Null", "AI diagnosis suggestions"],
        ["doctor_notes", "Text", "Not Null", "Doctor consultation notes"],
        ["final_diagnosis", "Text", "Not Null", "Final diagnosis text"],
        ["to_emergency", "Boolean", "Not Null", "Emergency escalation flag"],
        ["razorpay_order_id", "Varchar(100)", "Not Null", "Razorpay order ID"],
        ["payment_status", "Varchar(20)", "Not Null", "Payment status"],
        ["started_at", "DateTime", "Null", "Consultation start timestamp"],
        ["ended_at", "DateTime", "Null", "Consultation end timestamp"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
     ]),
    ("prescriptions",
     "Stores doctor-issued prescriptions with medicine details.",
     [
        ["prescription_id", "UUID", "Primary Key, Not Null", "Unique prescription identifier"],
        ["doctor_id", "UUID", "FK to doctor_registrations", "Prescribing doctor reference"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["consultation_id", "UUID", "FK to consultations, Null", "Related consultation reference"],
        ["medicines", "JSON", "Not Null", "List of prescribed medicines with dosage"],
        ["diagnosis", "Text", "Not Null", "Diagnosis for prescription"],
        ["instructions", "Text", "Not Null", "Usage instructions"],
        ["is_verified", "Boolean", "Not Null", "Prescription verification status"],
        ["valid_until", "Date", "Null", "Prescription validity date"],
        ["pdf_url", "Varchar(500)", "Not Null", "Generated PDF URL"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
     ]),
    ("pharmacist_registrations",
     "Stores registered pharmacist and pharmacy details.",
     [
        ["pharmacist_id", "UUID", "Primary Key, Not Null", "Unique pharmacist identifier"],
        ["login_id", "UUID", "Unique, FK to login_credentials", "Reference to login credentials"],
        ["pharmacy_name", "Varchar(200)", "Not Null", "Pharmacy name"],
        ["license_no", "Varchar(50)", "Unique, Not Null", "Pharmacy license number"],
        ["full_name", "Varchar(100)", "Not Null", "Pharmacist full name"],
        ["address", "Text", "Not Null", "Pharmacy address"],
        ["latitude", "Decimal", "Null", "GPS latitude coordinate"],
        ["longitude", "Decimal", "Null", "GPS longitude coordinate"],
        ["approval_status", "Varchar(20)", "Not Null", "Account approval status"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("medicine_orders",
     "Stores patient medicine orders with prescription verification and delivery tracking.",
     [
        ["med_order_id", "UUID", "Primary Key, Not Null", "Unique order identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["pharmacist_id", "UUID", "FK to pharmacist_registrations, Null", "Pharmacist reference"],
        ["prescription_id", "UUID", "FK to prescriptions, Null", "Related prescription reference"],
        ["medicines", "JSON", "Not Null", "Ordered medicines list"],
        ["total_amount", "Decimal", "Not Null", "Total order amount"],
        ["payment_status", "Varchar(20)", "Not Null", "Payment status"],
        ["razorpay_order_id", "Varchar(100)", "Not Null", "Razorpay order ID"],
        ["delivery_address", "Text", "Not Null", "Delivery address"],
        ["order_status", "Varchar(30)", "Not Null", "Order status"],
        ["prescription_url", "Varchar(500)", "Not Null", "Prescription file URL"],
        ["prescription_verified", "Boolean", "Not Null", "Prescription verification flag"],
        ["requires_prescription", "Boolean", "Not Null", "Prescription requirement flag"],
        ["payment_enabled", "Boolean", "Not Null", "Payment enabled flag"],
        ["delivery_otp", "Varchar(6)", "Not Null", "Delivery OTP code"],
        ["otp_expiry", "DateTime", "Null", "OTP expiry timestamp"],
        ["otp_verified", "Boolean", "Not Null", "OTP verification flag"],
        ["estimated_delivery_days", "Integer", "Not Null", "Estimated delivery days"],
        ["dispatched_at", "DateTime", "Null", "Dispatch timestamp"],
        ["delivered_at", "DateTime", "Null", "Delivery timestamp"],
        ["status_history", "JSON", "Not Null", "Order status history log"],
        ["ordered_at", "DateTime", "Not Null", "Order creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Last update timestamp"],
     ]),
    ("pharmacy_inventory",
     "Stores pharmacy medicine inventory with stock and expiry details.",
     [
        ["inventory_id", "UUID", "Primary Key, Not Null", "Unique inventory identifier"],
        ["pharmacy_id", "UUID", "FK to pharmacist_registrations", "Pharmacy reference"],
        ["medicine_name", "Varchar(200)", "Not Null", "Medicine name"],
        ["generic_name", "Varchar(200)", "Not Null", "Generic medicine name"],
        ["category", "Varchar(20)", "Not Null", "Category (tablet/syrup/injection/cream)"],
        ["description", "Text", "Not Null", "Medicine description"],
        ["price_per_unit", "Decimal", "Not Null", "Price per unit"],
        ["unit", "Varchar(20)", "Not Null", "Unit type"],
        ["stock_quantity", "Integer", "Not Null", "Available stock count"],
        ["reorder_level", "Integer", "Not Null", "Minimum reorder threshold"],
        ["requires_prescription", "Boolean", "Not Null", "Prescription requirement flag"],
        ["medicine_image", "FileField", "Null", "Medicine image file"],
        ["manufacturer", "Varchar(200)", "Not Null", "Manufacturer name"],
        ["expiry_date", "Date", "Null", "Medicine expiry date"],
        ["is_available", "Boolean", "Not Null", "Availability flag"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("lab_tech_registrations",
     "Stores registered laboratory technician profile details.",
     [
        ["lab_tech_id", "UUID", "Primary Key, Not Null", "Unique lab tech identifier"],
        ["login_id", "UUID", "Unique, FK to login_credentials", "Reference to login credentials"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Associated hospital reference"],
        ["full_name", "Varchar(100)", "Not Null", "Lab technician full name"],
        ["qualification", "Varchar(100)", "Not Null", "Educational qualification"],
        ["specialization", "Varchar(100)", "Not Null", "Area of specialization"],
        ["phone", "Varchar(15)", "Not Null", "Contact phone number"],
        ["approval_status", "Varchar(20)", "Not Null", "Account approval status"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("lab_orders",
     "Stores lab test orders created by doctors during consultations.",
     [
        ["order_id", "UUID", "Primary Key, Not Null", "Unique order identifier"],
        ["doctor_id", "UUID", "FK to doctor_registrations", "Ordering doctor reference"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["lab_tech_id", "UUID", "FK to lab_tech_registrations, Null", "Assigned lab tech reference"],
        ["tests_ordered", "JSON", "Not Null", "List of tests ordered"],
        ["priority", "Varchar(20)", "Not Null", "Priority level (STAT/URGENT/NORMAL)"],
        ["status", "Varchar(20)", "Not Null", "Order status"],
        ["notes", "Text", "Not Null", "Additional notes"],
        ["payment_status", "Varchar(20)", "Not Null", "Payment status"],
        ["ordered_at", "DateTime", "Not Null", "Order creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Last update timestamp"],
     ]),
    ("lab_reports",
     "Stores completed lab test reports with results and AI analysis.",
     [
        ["report_id", "UUID", "Primary Key, Not Null", "Unique report identifier"],
        ["order_id", "UUID", "FK to lab_orders", "Related lab order reference"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["results", "JSON", "Not Null", "Test results data"],
        ["report_file_url", "Varchar(500)", "Not Null", "Report file URL"],
        ["abnormal_flags", "JSON", "Not Null", "Abnormal result indicators"],
        ["ai_analysis", "Text", "Not Null", "AI-generated analysis"],
        ["saved_to_ehr", "Boolean", "Not Null", "EHR save status flag"],
        ["uploaded_at", "DateTime", "Not Null", "Report upload timestamp"],
     ]),
    ("ambulance_driver_registrations",
     "Stores registered ambulance driver profile details.",
     [
        ["driver_id", "UUID", "Primary Key, Not Null", "Unique driver identifier"],
        ["login_id", "UUID", "Unique, FK to login_credentials", "Reference to login credentials"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Associated hospital reference"],
        ["full_name", "Varchar(100)", "Not Null", "Driver full name"],
        ["license_no", "Varchar(50)", "Unique, Not Null", "Driving license number"],
        ["phone", "Varchar(15)", "Not Null", "Contact phone number"],
        ["is_available", "Boolean", "Not Null", "Availability status flag"],
        ["approval_status", "Varchar(20)", "Not Null", "Account approval status"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("ambulances",
     "Stores ambulance vehicle details and real-time GPS location.",
     [
        ["ambulance_id", "UUID", "Primary Key, Not Null", "Unique ambulance identifier"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Associated hospital reference"],
        ["driver_id", "UUID", "FK to ambulance_driver_registrations, Null", "Assigned driver reference"],
        ["vehicle_no", "Varchar(20)", "Unique, Not Null", "Vehicle registration number"],
        ["ambulance_type", "Varchar(20)", "Not Null", "Type (basic/advanced/ICU)"],
        ["equipment_list", "JSON", "Not Null", "Onboard equipment list"],
        ["is_available", "Boolean", "Not Null", "Availability status flag"],
        ["current_lat", "Decimal(10,7)", "Null", "Current GPS latitude"],
        ["current_lng", "Decimal(10,7)", "Null", "Current GPS longitude"],
        ["updated_at", "DateTime", "Not Null", "Last update timestamp"],
     ]),
    ("emergency_requests",
     "Stores patient emergency SOS requests with location and severity.",
     [
        ["emergency_id", "UUID", "Primary Key, Not Null", "Unique emergency identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["triage_id", "UUID", "FK to triage_sessions, Null", "Related triage session"],
        ["patient_lat", "Decimal(10,7)", "Not Null", "Patient GPS latitude"],
        ["patient_lng", "Decimal(10,7)", "Not Null", "Patient GPS longitude"],
        ["severity", "Varchar(20)", "Not Null", "Severity level (low/moderate/high/critical)"],
        ["status", "Varchar(20)", "Not Null", "Status (pending/dispatched/completed)"],
        ["assigned_hospital_id", "UUID", "FK to hospital_registrations, Null", "Nearest hospital reference"],
        ["assigned_bed_id", "UUID", "FK to beds, Null", "Assigned bed reference"],
        ["created_at", "DateTime", "Not Null", "Emergency creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Last update timestamp"],
     ]),
    ("ambulance_dispatch",
     "Stores ambulance dispatch records linking emergencies to ambulances.",
     [
        ["dispatch_id", "UUID", "Primary Key, Not Null", "Unique dispatch identifier"],
        ["emergency_id", "UUID", "FK to emergency_requests", "Emergency reference"],
        ["ambulance_id", "UUID", "FK to ambulances", "Assigned ambulance reference"],
        ["dispatch_status", "Varchar(30)", "Not Null", "Status (dispatched/en_route/arrived/completed)"],
        ["eta_minutes", "Integer", "Null", "Estimated arrival time in minutes"],
        ["route_data", "JSON", "Not Null", "Route waypoints data"],
        ["dispatched_at", "DateTime", "Not Null", "Dispatch timestamp"],
        ["arrived_at", "DateTime", "Null", "Arrival timestamp"],
        ["completed_at", "DateTime", "Null", "Trip completion timestamp"],
     ]),
    ("vendor_registrations",
     "Stores registered medical equipment vendor details.",
     [
        ["vendor_id", "UUID", "Primary Key, Not Null", "Unique vendor identifier"],
        ["login_id", "UUID", "Unique, FK to login_credentials", "Reference to login credentials"],
        ["company_name", "Varchar(200)", "Not Null", "Company name"],
        ["tax_id", "Varchar(50)", "Unique, Not Null", "Tax identification number"],
        ["contact_name", "Varchar(100)", "Not Null", "Primary contact person name"],
        ["phone", "Varchar(15)", "Not Null", "Contact phone number"],
        ["business_license_url", "Varchar(500)", "Not Null", "Business license document URL"],
        ["certifications", "JSON", "Not Null", "List of certifications"],
        ["approval_status", "Varchar(20)", "Not Null", "Account approval status"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Record last update timestamp"],
     ]),
    ("equipment_catalog",
     "Stores medical equipment listed by vendors for hospital purchase.",
     [
        ["product_id", "UUID", "Primary Key, Not Null", "Unique product identifier"],
        ["vendor_id", "UUID", "FK to vendor_registrations", "Vendor reference"],
        ["product_name", "Varchar(200)", "Not Null", "Equipment product name"],
        ["category", "Varchar(50)", "Not Null", "Equipment category"],
        ["specifications", "JSON", "Not Null", "Technical specifications"],
        ["price", "Decimal", "Not Null", "Product price"],
        ["stock_qty", "Integer", "Not Null", "Available stock quantity"],
        ["image_url", "Varchar(500)", "Not Null", "Product image URL"],
        ["listed_at", "DateTime", "Not Null", "Listing creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Last update timestamp"],
     ]),
    ("equipment_orders",
     "Stores hospital equipment orders with payment and OTP delivery tracking.",
     [
        ["eq_order_id", "UUID", "Primary Key, Not Null", "Unique order identifier"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Ordering hospital reference"],
        ["vendor_id", "UUID", "FK to vendor_registrations", "Vendor reference"],
        ["product_id", "UUID", "FK to equipment_catalog", "Ordered product reference"],
        ["quantity", "Integer", "Not Null", "Ordered quantity"],
        ["total_price", "Decimal", "Not Null", "Total order price"],
        ["order_status", "Varchar(30)", "Not Null", "Order status"],
        ["razorpay_order_id", "Varchar(100)", "Not Null", "Razorpay order ID"],
        ["payment_status", "Varchar(20)", "Not Null", "Payment status"],
        ["tracking_info", "Text", "Not Null", "Delivery tracking information"],
        ["delivery_otp", "Varchar(6)", "Not Null", "Delivery OTP code"],
        ["otp_expiry", "DateTime", "Null", "OTP expiry timestamp"],
        ["otp_verified", "Boolean", "Not Null", "OTP verification flag"],
        ["estimated_delivery_days", "Integer", "Not Null", "Estimated delivery days"],
        ["dispatched_at", "DateTime", "Null", "Dispatch timestamp"],
        ["delivered_at", "DateTime", "Null", "Delivery timestamp"],
        ["status_history", "JSON", "Not Null", "Order status history log"],
        ["ordered_at", "DateTime", "Not Null", "Order creation timestamp"],
        ["updated_at", "DateTime", "Not Null", "Last update timestamp"],
     ]),
    ("triage_sessions",
     "Stores AI-powered triage session results for patient symptom checking.",
     [
        ["triage_id", "UUID", "Primary Key, Not Null", "Unique triage identifier"],
        ["patient_id", "UUID", "FK to patient_registrations", "Patient reference"],
        ["symptoms_input", "JSON", "Not Null", "Patient reported symptoms"],
        ["predicted_diseases", "JSON", "Not Null", "AI predicted disease list with confidence"],
        ["confidence_score", "Decimal", "Null", "Overall prediction confidence score"],
        ["severity", "Varchar(20)", "Not Null", "Assessed severity level"],
        ["model_version", "Varchar(50)", "Not Null", "AI model version used"],
        ["emergency_triggered", "Boolean", "Not Null", "Emergency SOS trigger flag"],
        ["recommendation", "Text", "Not Null", "AI recommendation text"],
        ["created_at", "DateTime", "Not Null", "Session creation timestamp"],
     ]),
    ("fl_global_models",
     "Stores federated learning global model versions and performance metrics.",
     [
        ["model_id", "UUID", "Primary Key, Not Null", "Unique model identifier"],
        ["version", "Varchar(50)", "Unique, Not Null", "Model version string"],
        ["weights_file_url", "Varchar(500)", "Not Null", "Model weights file URL"],
        ["accuracy", "Decimal", "Null", "Model accuracy percentage"],
        ["hospitals_count", "Integer", "Not Null", "Number of participating hospitals"],
        ["aggregation_algo", "Varchar(50)", "Not Null", "Aggregation algorithm (FedAvg)"],
        ["is_active", "Boolean", "Not Null", "Active model flag"],
        ["privacy_epsilon", "Decimal", "Null", "Differential privacy epsilon value"],
        ["created_at", "DateTime", "Not Null", "Model creation timestamp"],
     ]),
    ("fl_rounds",
     "Stores federated learning training round details and status.",
     [
        ["round_id", "UUID", "Primary Key, Not Null", "Unique round identifier"],
        ["model_id", "UUID", "FK to fl_global_models", "Parent model reference"],
        ["round_number", "Integer", "Not Null", "Sequential round number"],
        ["status", "Varchar(20)", "Not Null", "Round status (pending/active/completed)"],
        ["hospitals_invited", "Integer", "Not Null", "Number of invited hospitals"],
        ["hospitals_completed", "Integer", "Not Null", "Number of completed submissions"],
        ["global_loss", "Decimal", "Null", "Global model loss value"],
        ["started_at", "DateTime", "Null", "Round start timestamp"],
        ["completed_at", "DateTime", "Null", "Round completion timestamp"],
        ["round_deadline", "DateTime", "Null", "Submission deadline"],
        ["min_hospitals_threshold", "Integer", "Not Null", "Minimum required hospitals"],
        ["auto_aggregated", "Boolean", "Not Null", "Auto aggregation flag"],
        ["reminder_sent", "Boolean", "Not Null", "Reminder notification sent flag"],
        ["created_at", "DateTime", "Not Null", "Record creation timestamp"],
     ]),
    ("fl_hospital_weights",
     "Stores individual hospital model weight submissions for federated learning.",
     [
        ["weight_id", "UUID", "Primary Key, Not Null", "Unique weight identifier"],
        ["round_id", "UUID", "FK to fl_rounds", "FL round reference"],
        ["hospital_id", "UUID", "FK to hospital_registrations", "Submitting hospital reference"],
        ["weights_file_url", "Varchar(500)", "Not Null", "Weight file URL"],
        ["local_accuracy", "Decimal", "Null", "Local model accuracy"],
        ["local_loss", "Decimal", "Null", "Local model loss"],
        ["training_samples", "Integer", "Not Null", "Number of training samples used"],
        ["noise_added", "Boolean", "Not Null", "Differential privacy noise flag"],
        ["submitted_at", "DateTime", "Not Null", "Submission timestamp"],
     ]),
    ("epidemic_trends",
     "Stores epidemic detection and disease trend monitoring data.",
     [
        ["trend_id", "UUID", "Primary Key, Not Null", "Unique trend identifier"],
        ["disease_name", "Varchar(100)", "Not Null", "Disease name"],
        ["region", "Varchar(100)", "Not Null", "Affected region"],
        ["case_count", "Integer", "Not Null", "Number of reported cases"],
        ["spike_detected", "Boolean", "Not Null", "Epidemic spike detection flag"],
        ["heatmap_data", "JSON", "Not Null", "Geographic heatmap data"],
        ["alert_level", "Varchar(20)", "Not Null", "Alert level (low/medium/high/critical)"],
        ["recorded_date", "Date", "Not Null", "Data recording date"],
     ]),
]


# ─── Paragraph styles ─────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

cell_style = ParagraphStyle(
    'Cell', parent=styles['Normal'], fontName='Helvetica',
    fontSize=9, leading=11, alignment=TA_LEFT,
)
cell_bold = ParagraphStyle(
    'CellBold', parent=cell_style, fontName='Helvetica-Bold',
)
header_cell = ParagraphStyle(
    'HeaderCell', parent=styles['Normal'], fontName='Helvetica-Bold',
    fontSize=10, leading=12, alignment=TA_CENTER,
)
section_style = ParagraphStyle(
    'Section', parent=styles['Normal'], fontName='Helvetica-Bold',
    fontSize=12, leading=15, textColor=BRAND, spaceBefore=4, spaceAfter=3,
)
desc_style = ParagraphStyle(
    'Desc', parent=styles['Normal'], fontName='Helvetica-BoldOblique',
    fontSize=9.5, leading=12, textColor=colors.HexColor('#333333'),
    spaceAfter=6,
)
title_big = ParagraphStyle(
    'TitleBig', parent=styles['Title'], fontName='Helvetica-Bold',
    fontSize=28, leading=34, alignment=TA_CENTER, textColor=BRAND,
)
title_sub = ParagraphStyle(
    'TitleSub', parent=styles['Normal'], fontName='Helvetica-Bold',
    fontSize=16, leading=22, alignment=TA_CENTER, textColor=colors.HexColor('#2E75B6'),
)
title_line = ParagraphStyle(
    'TitleLine', parent=styles['Normal'], fontName='Helvetica',
    fontSize=13, leading=20, alignment=TA_CENTER,
)


# ─── Header / footer drawn on every page ──────────────────────────────────────
def draw_header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4

    # Header — right aligned, italic
    canvas.setFont('Helvetica-Oblique', 9)
    canvas.setFillColor(colors.HexColor('#555555'))
    canvas.drawRightString(width - 2 * cm, height - 1.3 * cm,
                           'FederCare: AI Health Network')
    canvas.setStrokeColor(colors.HexColor('#CCCCCC'))
    canvas.setLineWidth(0.5)
    canvas.line(2 * cm, height - 1.5 * cm, width - 2 * cm, height - 1.5 * cm)

    # Footer — institute left (italic bold), page number right
    canvas.setFont('Helvetica-BoldOblique', 8.5)
    canvas.setFillColor(colors.HexColor('#555555'))
    canvas.drawString(2 * cm, 1.1 * cm,
                      'Mar Thoma Institute of Information Technology, Ayur')
    canvas.setFont('Helvetica', 9)
    canvas.drawRightString(width - 2 * cm, 1.1 * cm, str(doc.page))
    canvas.line(2 * cm, 1.45 * cm, width - 2 * cm, 1.45 * cm)

    canvas.restoreState()


# ─── Title page ───────────────────────────────────────────────────────────────
def build_title_page():
    elems = [
        Spacer(1, 5 * cm),
        Paragraph('FederCare: AI Health Network', title_big),
        Spacer(1, 1 * cm),
        Paragraph('Database Design Document', title_sub),
        Spacer(1, 2.5 * cm),
        Paragraph('Department of Computer Applications', title_line),
        Spacer(1, 0.3 * cm),
        Paragraph('Mar Thoma Institute of Information Technology, Ayur', title_line),
        Spacer(1, 1.2 * cm),
        Paragraph('Academic Year: 2025-2026', title_line),
        PageBreak(),
    ]
    return elems


# ─── Table section ────────────────────────────────────────────────────────────
COL_WIDTHS = [110, 80, 120, 180]


def build_table_section(index, table_name, description, fields):
    elems = []
    elems.append(Paragraph(f'{index}. Table Name: {table_name}', section_style))
    elems.append(Paragraph(f'Description: {description}', desc_style))

    # Header row
    data = [[
        Paragraph('Attribute', header_cell),
        Paragraph('Data Type', header_cell),
        Paragraph('Constraints', header_cell),
        Paragraph('Description', header_cell),
    ]]
    for attr, dtype, constr, desc in fields:
        data.append([
            Paragraph(attr, cell_bold),
            Paragraph(dtype, cell_style),
            Paragraph(constr, cell_style),
            Paragraph(desc, cell_style),
        ])

    tbl = Table(data, colWidths=COL_WIDTHS, repeatRows=1)

    style = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('GRID', (0, 0), (-1, -1), 0.6, BORDER),
        ('BOX', (0, 0), (-1, -1), 1.0, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]
    # Alternating row backgrounds (white / very light grey)
    for r in range(1, len(data)):
        if r % 2 == 0:
            style.append(('BACKGROUND', (0, r), (-1, r), ROW_ALT_BG))
    tbl.setStyle(TableStyle(style))

    elems.append(tbl)
    elems.append(Spacer(1, 15))
    return elems


# ─── Build document ───────────────────────────────────────────────────────────
def generate_pdf():
    doc = SimpleDocTemplate(
        OUTPUT_FILE,
        pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title='FederCare Database Design Document',
        author='Adithya M',
    )

    story = []
    story.extend(build_title_page())

    for i, (table_name, description, fields) in enumerate(TABLES, start=1):
        story.extend(build_table_section(i, table_name, description, fields))

    doc.build(story, onFirstPage=draw_header_footer,
              onLaterPages=draw_header_footer)


if __name__ == '__main__':
    generate_pdf()
    total_fields = sum(len(t[2]) for t in TABLES)
    print('=' * 50)
    print('  PDF generated successfully!')
    print(f'  All {len(TABLES)} tables included ({total_fields} attributes)')
    print('  Professional academic format')
    print('  Header and footer on every page')
    print(f'  File saved as {OUTPUT_FILE}')
    print('=' * 50)
