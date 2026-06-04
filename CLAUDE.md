# FederCare: AI Health Network — CLAUDE.md

## Project Overview
FederCare is a **Federated AI-Powered Multi-Hospital Healthcare Web Application** built as a Final Year MCA Project.

- **Institution:** Mar Thoma Institute of Information Technology, Ayur (MRIT), Chadayamangalam, Kollam
- **Student:** Adithya M | Reg No: 95524455004
- **Guide:** Mrs. Princy Thomas, Assistant Professor
- **Course:** Master of Computer Applications, University of Kerala

---

## Tech Stack

### Backend
- Python 3.11
- Django 4.2 + Django REST Framework
- Simple JWT (authentication)
- Django Channels + InMemoryChannelLayer (WebSocket)
- Django CORS Headers
- Scikit-learn (ML models)
- Flower / flwr (Federated Learning)
- Razorpay (payments)
- local storage(file/image storage)
- ReportLab (PDF generation)
- qrcode[pil] (QR code generation)
- Pandas, NumPy, Matplotlib (data processing)
- SQLite (database — local development)
- python-dotenv (environment variables)

### Frontend
- React.js 18
- Tailwind CSS (styling)
- React Router DOM v6 (routing)
- Axios (API calls)
- Leaflet.js + React-Leaflet (maps)
- Recharts (charts and graphs)
- React Hot Toast (notifications)

---

## Project Folder Structure

```
federcare/
├── CLAUDE.md                        ← this file
├── .env                             ← environment variables (never commit)
├── .gitignore
│
├── backend/                         ← Django backend
│   ├── manage.py
│   ├── requirements.txt
│   ├── federcare/                   ← Django project settings
│   │   ├── settings.py
│   │   ├── urls.py
│   │   ├── asgi.py
│   │   └── wsgi.py
│   │
│   └── apps/
│       ├── auth_app/                ← Login, JWT, RBAC, Audit
│       ├── hospital/                ← Hospital Admin module
│       ├── patient/                 ← Patient module
│       ├── doctor/                  ← Doctor module
│       ├── pharmacy/                ← Pharmacist module
│       ├── lab/                     ← Lab Technician module
│       ├── emergency/               ← Ambulance Driver module
│       ├── vendor/                  ← Equipment Vendor module
│       ├── ai_engine/               ← AI Symptom Checker, Risk Prediction
│       └── federated/               ← Federated Learning Engine
│
├── frontend/                        ← React.js frontend
│   ├── package.json
│   ├── tailwind.config.js
│   └── src/
│       ├── App.jsx
│       ├── index.jsx
│       ├── api/
│       │   └── axios.js
│       ├── context/
│       │   └── AuthContext.jsx
│       ├── components/
│       │   └── common/
│       └── pages/
│
├── ml_models/                       ← Trained ML model .pkl files
│   ├── datasets/                    ← CSV datasets from Kaggle
│   ├── train_models.py              ← Script to train and save models
│   ├── symptom_checker_lr.pkl
│   ├── clinical_diagnosis_rf.pkl
│   └── risk_predictor_rf.pkl
│
└── docs/                            ← DFD diagrams, abstract, documentation
```

---

## Environment Variables (.env)

```
RAZORPAY_KEY_ID=your_test_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
DJANGO_SECRET_KEY=your_django_secret_key
DEBUG=True
```

---

## 8 User Roles

| Role | Registration | Key Responsibility |
|---|---|---|
| super_admin | Pre-seeded by developer | Platform governance, approvals, FL oversight |
| hospital_admin | Self-registers → Super Admin approves | Hospital setup, add staff, bed/inventory management |
| doctor | Added by Hospital Admin | AI diagnosis, telemedicine, prescriptions |
| patient | Self-registers → auto approved | EHR wallet, symptom checker, booking, emergency |
| pharmacist | Self-registers → Super Admin approves | Verify Rx, process medicine orders |
| lab_tech | Added by Hospital Admin | Process tests, upload reports, AI flag |
| driver | Added by Hospital Admin | GPS dispatch, ambulance tracking |
| vendor | Self-registers → Super Admin approves | Equipment catalog, order fulfillment |

---

## Central Authentication Design

**CRITICAL RULE:** There is ONE central table `LoginCredentials` in `auth_app`.
Every role-specific table links to it via `OneToOneField`.

```python
# auth_app LoginCredentials — central login table
login_id (UUID PK)
email (unique)
password_hash
role → choices: super_admin/hospital_admin/doctor/patient/pharmacist/lab_tech/driver/vendor
is_active (default False)
is_approved (default False)
last_login
login_attempts (default 0)
created_at
updated_at

# Every other model links like this:
login_id = models.OneToOneField(LoginCredentials, on_delete=models.CASCADE)
```

---

## All Database Models (30+ tables)

### auth_app
- `LoginCredentials` — central login table (all roles)
- `SuperAdmin` — super admin profile
- `RolePermissions` — RBAC per role and module
- `LoginSession` — JWT session tracking
- `AuditLog` — system-wide action audit trail
- `Notification` — push notifications for all users

### hospital
- `HospitalRegistration` — hospital profile + GPS coords + approval_status
- `Department` — hospital departments (FK → HospitalRegistration)
- `Bed` — real-time bed/ICU availability (FK → HospitalRegistration)
- `HospitalInventory` — medical supplies stock (FK → HospitalRegistration)

### patient
- `PatientRegistration` — patient profile + BMI + lifestyle_data + qr_code_url
- `EHRRecord` — EHR wallet entries grouped by type
- `Allergy` — patient allergy records
- `EHRConsentLog` — QR-based consent tracking (30 min expiry)
- `RiskAssessment` — AI health risk scores

### doctor
- `DoctorRegistration` — doctor profile (FK → HospitalRegistration + Department)
- `DoctorSlot` — available time slots
- `Consultation` — video consultation session with jitsi_room_id
- `Prescription` — digital prescription with medicines JSONField + pdf_url

### pharmacy
- `PharmacistRegistration` — pharmacy profile + GPS
- `MedicineOrder` — patient medicine orders with razorpay_order_id + payment fields

### lab
- `LabTechRegistration` — lab tech profile (FK → HospitalRegistration)
- `LabOrder` — test orders from doctors with razorpay_order_id
- `LabReport` — uploaded results + abnormal_flags + ai_analysis

### emergency
- `AmbulanceDriverRegistration` — driver profile (FK → HospitalRegistration)
- `Ambulance` — vehicle with current_lat + current_lng (live GPS)
- `EmergencyRequest` — patient SOS with GPS coords + assigned hospital + bed
- `AmbulanceDispatch` — dispatch log with route_data + ETA + status

### vendor
- `VendorRegistration` — vendor company profile
- `EquipmentCatalog` — products with specs + price + stock_qty
- `EquipmentOrder` — hospital procurement with razorpay_order_id

### ai_engine
- `TriageSession` — AI symptom checker sessions (LR model output)

### federated
- `FLGlobalModel` — global model versions (.pkl file URL)
- `FLRound` — training round lifecycle
- `FLHospitalWeight` — encrypted local weights per hospital per round
- `EpidemicTrend` — anonymized disease trend data by region

---

## AI Models & Algorithms

| Model | Algorithm | Dataset | Purpose |
|---|---|---|---|
| symptom_checker_lr.pkl | Logistic Regression | Symptom-Disease (Kaggle) | Predict diseases from symptoms + classify severity |
| clinical_diagnosis_rf.pkl | Random Forest | Symptom-Disease (Kaggle) | AI suggestions for doctor with confidence % |
| risk_predictor_rf.pkl | Random Forest | Diabetes + Heart Disease (Kaggle) | Predict diabetes/heart/hypertension risk % |
| Lab flagging | Rule-based | Normal ranges | Flag abnormal test values automatically |
| FL aggregation | FedAvg (Flower) | Hospital local data | Aggregate local weights into global model |

### Severity Classification (Symptom Checker)
- low → recommend home rest
- moderate → recommend doctor consultation
- high → recommend immediate hospital visit
- critical → auto-trigger emergency module

---

## Federated Learning Flow

```
1. Super Admin initializes base global model on FL server
2. Global model distributed to all approved hospital FL clients
3. Each hospital trains LOCAL model on its OWN patient data
4. Hospital sends ONLY encrypted weights (NOT raw data) to server
5. FL server runs FedAvg — mathematically averages all weights
6. New improved global model saved to FLGlobalModel table
7. Updated model redistributed to all hospitals
8. Cycle repeats — model improves every round
```

**CRITICAL:** Raw patient data NEVER leaves the hospital. Only encrypted model weights travel.

---

## Payment Integration (Razorpay)

Razorpay is used for 4 payment flows:

| Flow | Amount Source | Who Pays | On Success |
|---|---|---|---|
| Book Consultation | DoctorRegistration.consultation_fee | Patient | Consultation confirmed |
| Order Medicine | MedicineOrder.total_amount | Patient | Pharmacist notified |
| Book Lab Test | Fixed fee per test | Patient | Lab order created |
| Equipment Order | EquipmentOrder.total_price | Hospital Admin | Vendor notified |

### Payment fields added to models:
```python
razorpay_order_id = models.CharField(max_length=100, blank=True)
razorpay_payment_id = models.CharField(max_length=100, blank=True)
razorpay_signature = models.CharField(max_length=200, blank=True)
payment_status = models.CharField(choices=['pending','paid','failed'], default='pending')
```

---

## WebSocket Channels

| Channel | URL | Purpose |
|---|---|---|
| GPS | ws/gps/<dispatch_id>/ | Driver broadcasts live GPS → patient map updates |
| Notifications | ws/notifications/<login_id>/ | Real-time push alerts to all users |
| Order Status | ws/orders/<order_id>/ | Pharmacist updates → patient sees live status |

---

## API Response Format

All APIs must return consistent JSON:
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}
```

Error response:
```json
{
  "success": false,
  "message": "Error description here",
  "errors": {}
}
```

---

## API URL Patterns

```
/api/auth/          → auth_app (login, register, profile, approvals)
/api/hospital/      → hospital app
/api/doctor/        → doctor app
/api/patient/       → patient app
/api/pharmacy/      → pharmacy app
/api/lab/           → lab app
/api/emergency/     → emergency app
/api/vendor/        → vendor app
/api/ai/            → ai_engine app
/api/federated/     → federated app
/api/payment/       → Razorpay payment APIs
```

---

## Coding Rules & Standards

1. Use `UUIDField` as primary key for ALL models
2. Use `auto_now_add=True` for `created_at` and `auto_now=True` for `updated_at`
3. All views use `APIView` from DRF
4. All protected views require JWT — use `@permission_classes([IsAuthenticated])`
5. Write to `AuditLog` for all important create/update/delete actions
6. Use `send_notification()` helper for all notifications
7. All file uploads go to Cloudinary — never local storage
8. Passwords hashed using Django's `make_password()` and verified with `check_password()`
9. Use `.env` file for all API keys — never hardcode
10. CORS allowed for `http://localhost:3000` in development

---

## Frontend Routing Rules

```
Public routes (no auth):
/ → Index/Landing page
/login → Login page
/register/patient → Patient registration
/register/hospital → Hospital registration
/register/pharmacist → Pharmacist registration
/register/vendor → Vendor registration

Protected routes (JWT required — role checked):
/admin/*        → role: super_admin
/hospital/*     → role: hospital_admin
/doctor/*       → role: doctor
/patient/*      → role: patient
/pharmacist/*   → role: pharmacist
/lab/*          → role: lab_tech
/driver/*       → role: driver
/vendor/*       → role: vendor
```

---

## Tailwind Color Scheme

> ⚠️ **LEGACY (dashboards only).** The navy palette below is the *old* design and
> is kept only because existing role dashboards still use it. **Do NOT use navy
> backgrounds on new or landing-aligned pages** — follow the **FederCare Design
> System** section below instead (cream + orange).

```js
colors: {
  primary: '#1A3C6E',      // dark navy — FederCare brand
  secondary: '#2E75B6',    // medium blue
  accent: '#00D4FF',       // neon cyan
  success: '#06D6A0',      // green
  danger: '#EF4444',       // red
  warning: '#F59E0B',      // amber
  light: '#F8FAFF',        // page background
}
```

---

## FEDERCARE DESIGN SYSTEM

> The single source of truth for the public/landing look. Extracted directly
> from the live landing page (`frontend/public/landing/` — `index.html` +
> `assets/css/output.css`). All future pages should match these tokens.

### Colors (exact values from the landing template)

| Token | Hex | Usage |
|---|---|---|
| Background (cream) | `#fff6ec` | Page + navbar background (`--background`) |
| Primary accent (orange) | `#ff4f01` | Buttons, accents, highlights, active states, links-on-hover (`--primary-color`) |
| Heading black | `#101010` | Headings (`--black-100`) |
| Button black | `#070707` | Secondary buttons, dark surfaces (`--black-200`) |
| Soft black | `#1f1f1f` | Deep text / dark sections (`--black-300`) |
| Secondary | `#000000` | Primary-button text on orange (`--secondary-color`) |
| White | `#ffffff` | Cards, light surfaces (`--white-color`) |
| Neutral border | `#e5e5e5` | Card / divider borders (Tailwind neutral) |

Note: the template's `--border-color` is the orange `#ff4f01` (used for accent
borders). For ordinary card outlines use the neutral `#e5e5e5`.

### Typography

- Loaded via Google Fonts (`Bricolage Grotesque` + `Manrope`).
- **Headings:** `"Bricolage Grotesque", sans-serif` — bold, large, `#101010`.
- **Body / UI:** `"Manrope", sans-serif` — regular, `#666` grey for secondary text.
- Tailwind: `font-bricolage` for headings, default sans for body.

### Components

**NAVBAR**
- Fixed top bar, `bg-background` (cream `#fff6ec`), `py-5`, becomes sticky on scroll.
- Logo: `.fc-logo` — Bricolage bold + orange pulse mark (`ri-pulse-line`), `.fc-accent` orange "Care".
- Links: medium-weight, `hover:text-primary` (orange). Right side holds the two pill buttons.

**BUTTONS** (`.btn` base: `border-radius: 50px` pill · `padding: 17px 34px` · `font-weight:500` · `box-shadow: 0 4px 0 0 rgba(0,0,0,.25)` · `transition: all .5s`)
- **Primary:** `bg-primary text-secondary border-primary` → orange bg + black text. Hover → `bg-black-200 text-white`.
- **Secondary:** `bg-black-200 text-white border-black-200` → near-black bg + white text. Hover → `text-primary` (orange).

**CARDS**
- White background, rounded-`xl`/`2xl` corners, subtle neutral border (`#e5e5e5`).
- Lift/shadow on hover; orange accent for icons/active state.

### Design Rules
1. Page background is always cream `#fff6ec`.
2. Orange `#ff4f01` for: primary buttons, accents, highlights, active states, hovers.
3. Black (`#101010`/`#070707`) for: headings, secondary buttons, dark sections.
4. **No dark navy backgrounds** — that is the legacy dashboard design.
5. Clean and minimal; generous whitespace.
6. Consistent spacing (see layout rules).
7. Rounded corners everywhere (`50px` pills for buttons, `xl`/`2xl` for cards).
8. Smooth hover transitions (~`0.3s–0.5s`).

### Page Layout Rules
- Centered container (`.container`), responsive max-widths up to **1320px** at xl
  (≈1200px content); horizontal padding `12px+`.
- Section vertical rhythm: `lg:pt-25 pt-15` ≈ **100px desktop / 60px mobile** top padding per section.
- Always mobile-responsive (Tailwind `sm/md/lg` breakpoints).

---

## Demo Seed Data (for Panel Presentation)

```
Super Admin:    admin@federcare.com / Admin@123
Hospital 1:     City Medical Center, Thiruvananthapuram
Hospital 2:     MRIT Hospital, Ayur
Hospital 3:     Sunrise Healthcare, Kollam
Doctors:        3 per hospital (Cardiology, General, Neurology)
Lab Techs:      2 per hospital
Drivers:        2 per hospital
Patients:       5 patients with EHR records
Pharmacies:     2 pharmacies
Vendors:        2 vendors with 3-5 products each
FL Round:       1 completed round, accuracy 78.5%
```

---

## Test Credentials for Razorpay

```
Card Number : 4111 1111 1111 1111
Expiry      : Any future date
CVV         : Any 3 digits
OTP         : 1234
```

---

## Important Notes for Claude Code

- Always check if a model import is needed from another app before using it
- Use `from apps.auth_app.models import LoginCredentials` style imports
- Django Channels uses `InMemoryChannelLayer` — no Redis needed
- Jitsi Meet video uses free public API — room name = consultation_id
- Leaflet.js maps use OpenStreetMap tiles — no API key needed
- All ML models loaded once at startup using `joblib.load()` — not on every request
- FL simulation uses 3 virtual hospitals on same machine for demo
- Run Django on port 8000, React on port 3000
