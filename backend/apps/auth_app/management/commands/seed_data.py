"""
FederCare demo seed command.

Usage:
    python manage.py seed_data

Idempotent — uses get_or_create everywhere so it can be run multiple times.
Creates a complete demo dataset for the panel presentation.
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.auth_app.models import LoginCredentials, SuperAdmin
from apps.hospital.models import HospitalRegistration, Department, Bed, HospitalInventory, HospitalPatient
from apps.doctor.models import DoctorRegistration, DoctorSlot
from apps.patient.models import PatientRegistration, EHRRecord, RiskAssessment
from apps.lab.models import LabTechRegistration
from apps.emergency.models import AmbulanceDriverRegistration, Ambulance
from apps.pharmacy.models import PharmacistRegistration
from apps.vendor.models import VendorRegistration, EquipmentCatalog
from apps.federated.models import FLGlobalModel, FLRound, EpidemicTrend


class Command(BaseCommand):
    help = "Seed FederCare with full demo data for the panel presentation."

    def _ok(self, msg):
        self.stdout.write(self.style.SUCCESS(msg))

    def _info(self, msg):
        self.stdout.write(msg)

    def _warn(self, msg):
        self.stdout.write(self.style.WARNING(msg))

    # -- helpers ----------------------------------------------------
    def _create_login(self, *, email, password, role, is_active=True, is_approved=True):
        """get_or_create a LoginCredentials. Returns (login, created)."""
        login, created = LoginCredentials.objects.get_or_create(
            email=email,
            defaults={
                'password_hash': make_password(password),
                'role': role,
                'is_active': is_active,
                'is_approved': is_approved,
            },
        )
        if created:
            self._info(f"    - login created: {email} ({role})")
        else:
            # Make sure the demo password / approval state is correct
            login.password_hash = make_password(password)
            login.role = role
            login.is_active = is_active
            login.is_approved = is_approved
            login.save()
            self._info(f"    - login refreshed: {email} ({role})")
        return login, created

    # -- orchestrator ----------------------------------------------
    def handle(self, *args, **options):
        self._info("=" * 64)
        self._ok("FederCare seed_data — building demo dataset")
        self._info("=" * 64)

        counts = {}

        counts['super_admin'] = self.seed_super_admin()
        hospitals = self.seed_hospitals()
        counts['hospitals'] = len(hospitals)

        doctors = self.seed_doctors(hospitals)
        counts['doctors'] = len(doctors)

        counts['lab_techs'] = self.seed_lab_techs(hospitals)
        counts['drivers'] = self.seed_drivers(hospitals)
        patients = self.seed_patients()
        counts['patients'] = len(patients)

        counts['pharmacies'] = self.seed_pharmacies()
        counts['medicines'] = self.seed_pharmacy_inventory()
        counts['vendors'], counts['products'] = self.seed_vendors()
        counts['fl_rounds'] = self.seed_fl_data()
        counts['epidemic_trends'] = self.seed_epidemic_data()
        counts['doctor_slots'] = self.seed_doctor_slots(doctors)
        counts['hospital_patients'] = self.seed_hospital_patients(hospitals)

        # -- final summary -----------------------------------------
        self._info("\n" + "=" * 64)
        self._ok("SEED DATA SUMMARY")
        self._info("=" * 64)
        self._ok(f"[OK] Created {counts['super_admin']} super admin")
        self._ok(f"[OK] Created {counts['hospitals']} hospitals")
        self._ok(f"[OK] Created {counts['doctors']} doctors")
        self._ok(f"[OK] Created {counts['lab_techs']} lab technicians")
        self._ok(f"[OK] Created {counts['drivers']} ambulance drivers")
        self._ok(f"[OK] Created {counts['patients']} patients")
        self._ok(f"[OK] Created {counts['pharmacies']} pharmacies")
        self._ok(f"[OK] Created {counts['medicines']} pharmacy inventory medicines")
        self._ok(f"[OK] Created {counts['vendors']} vendors with {counts['products']} products")
        self._ok(f"[OK] Created {counts['fl_rounds']} FL rounds (1 global model)")
        self._ok(f"[OK] Created {counts['epidemic_trends']} epidemic trends")
        self._ok(f"[OK] Created {counts['doctor_slots']} doctor slots")
        self._ok(f"[OK] Created {counts['hospital_patients']} hospital patients (FL training data)")

        self._print_credentials()

    # -- 1. Super Admin --------------------------------------------
    def seed_super_admin(self):
        self._info("\n>> Seeding Super Admin")
        login, _ = self._create_login(
            email='federcaresupport@gmail.com',
            password='Admin@123',
            role='super_admin',
        )
        SuperAdmin.objects.get_or_create(
            login_id=login,
            defaults={'full_name': 'Dr. Federal Admin', 'phone': '9876500000'},
        )
        return 1

    # -- 2. Hospitals + Departments + Beds + Inventory ------------
    def seed_hospitals(self):
        self._info("\n>> Seeding Hospitals")

        hospital_specs = [
            {
                'email': 'federcaresupport+hospital1@gmail.com',
                'name': 'City Medical Center',
                'reg_no': 'KL-HOSP-001',
                'city': 'Thiruvananthapuram',
                'lat': 8.5241, 'lng': 76.9366,
                'phone': '9876500001',
                'departments': ['Cardiology', 'General Medicine', 'Neurology', 'Orthopedics', 'Pediatrics'],
                'beds': [
                    ('general', 'available', 3),
                    ('general', 'occupied', 2),
                    ('icu', 'available', 1),
                    ('icu', 'occupied', 1),
                    ('ventilator', 'available', 1),
                ],
                'inventory': [
                    ('Paracetamol 500mg', 'medicine', 500, 'tablets', 50),
                    ('Amoxicillin 250mg', 'medicine', 200, 'capsules', 30),
                    ('IV Fluids Normal Saline', 'supply', 50, 'bags', 15),
                    ('Surgical Gloves', 'supply', 8, 'boxes', 10),
                    ('Oxygen Cylinders', 'equipment', 5, 'cylinders', 3),
                ],
            },
            {
                'email': 'federcaresupport+hospital2@gmail.com',
                'name': 'MRIT Hospital',
                'reg_no': 'KL-HOSP-002',
                'city': 'Ayur',
                'lat': 9.0820, 'lng': 76.5827,
                'phone': '9876500002',
                'departments': ['General Medicine', 'Surgery'],
                'beds': [
                    ('general', 'available', 3),
                    ('icu', 'available', 1),
                ],
                'inventory': [],
            },
            {
                'email': 'federcaresupport+hospital3@gmail.com',
                'name': 'Sunrise Healthcare',
                'reg_no': 'KL-HOSP-003',
                'city': 'Kollam',
                'lat': 8.8932, 'lng': 76.6141,
                'phone': '9876500003',
                'departments': ['Cardiology', 'General Medicine'],
                'beds': [
                    ('general', 'available', 2),
                    ('general', 'occupied', 2),
                ],
                'inventory': [],
            },
        ]

        result = {}
        for spec in hospital_specs:
            self._info(f"  * {spec['name']}")
            login, _ = self._create_login(
                email=spec['email'], password='Hospital@123',
                role='hospital_admin',
            )
            hospital, _ = HospitalRegistration.objects.get_or_create(
                login_id=login,
                defaults={
                    'hospital_name': spec['name'],
                    'registration_no': spec['reg_no'],
                    'address': f"{spec['city']}, Kerala",
                    'city': spec['city'],
                    'state': 'Kerala',
                    'latitude': Decimal(str(spec['lat'])),
                    'longitude': Decimal(str(spec['lng'])),
                    'contact_phone': spec['phone'],
                    'contact_email': spec['email'],
                    'telemedicine_enabled': True,
                    'approval_status': 'approved',
                },
            )

            for dept_name in spec['departments']:
                Department.objects.get_or_create(
                    hospital_id=hospital, dept_name=dept_name,
                    defaults={'description': f"{dept_name} department"},
                )
            self._info(f"      - {len(spec['departments'])} departments")

            bed_count = 0
            for bed_type, status, qty in spec['beds']:
                for _ in range(qty):
                    Bed.objects.get_or_create(
                        hospital_id=hospital,
                        bed_type=bed_type,
                        ward_name=f"{bed_type.title()} Ward",
                        status=status,
                        defaults={},
                    )
                    bed_count += 1
            self._info(f"      - ~{bed_count} beds")

            for item_name, category, qty, unit, reorder in spec['inventory']:
                HospitalInventory.objects.get_or_create(
                    hospital_id=hospital, item_name=item_name,
                    defaults={
                        'category': category, 'quantity': qty,
                        'unit': unit, 'reorder_level': reorder,
                        'last_restocked': timezone.now(),
                    },
                )
            if spec['inventory']:
                self._info(f"      - {len(spec['inventory'])} inventory items")

            result[spec['reg_no']] = hospital

        return result

    # -- 3. Doctors ------------------------------------------------
    def seed_doctors(self, hospitals):
        self._info("\n>> Seeding Doctors")
        h1 = hospitals['KL-HOSP-001']
        h2 = hospitals['KL-HOSP-002']

        doctor_specs = [
            ('federcaresupport+doctor1@gmail.com', 'Doctor@Raja', 'Dr. Rajesh Kumar', 'Cardiology', 'MED-KL-001', 12, 500.00, h1),
            ('federcaresupport+doctor2@gmail.com',  'Doctor@Priy', 'Dr. Priya Sharma', 'General Medicine', 'MED-KL-002', 8, 300.00, h1),
            ('federcaresupport+doctor3@gmail.com',   'Doctor@Arun', 'Dr. Arun Nair',    'Neurology',  'MED-KL-003', 15, 700.00, h1),
            ('federcaresupport+doctor4@gmail.com',  'Doctor@Meer', 'Dr. Meera Pillai', 'General Medicine', 'MED-KL-004', 5, 250.00, h2),
        ]

        doctors = []
        for email, pwd, name, spec, license_no, exp, fee, hospital in doctor_specs:
            self._info(f"  * {name}")
            login, _ = self._create_login(email=email, password=pwd, role='doctor')

            dept = hospital.departments.filter(dept_name=spec).first() or hospital.departments.first()

            doc, _ = DoctorRegistration.objects.get_or_create(
                login_id=login,
                defaults={
                    'hospital_id': hospital,
                    'dept_id': dept,
                    'full_name': name,
                    'specialization': spec,
                    'license_no': license_no,
                    'experience_years': exp,
                    'consultation_fee': Decimal(str(fee)),
                    'approval_status': 'approved',
                    'is_online': True,
                },
            )
            doctors.append(doc)
        return doctors

    # -- 4. Lab Technicians ---------------------------------------
    def seed_lab_techs(self, hospitals):
        self._info("\n>> Seeding Lab Technicians")
        h1 = hospitals['KL-HOSP-001']

        lab_specs = [
            ('federcaresupport+lab1@gmail.com', 'Lab@Lab1', 'Ravi Krishnan', 'B.Sc MLT', 'Biochemistry'),
            ('federcaresupport+lab2@gmail.com', 'Lab@Lab2', 'Sreeja Mohan',  'B.Sc MLT', 'Microbiology'),
        ]

        for email, pwd, name, qual, spec in lab_specs:
            self._info(f"  * {name}")
            login, _ = self._create_login(email=email, password=pwd, role='lab_tech')
            LabTechRegistration.objects.get_or_create(
                login_id=login,
                defaults={
                    'hospital_id': h1,
                    'full_name': name,
                    'qualification': qual,
                    'specialization': spec,
                    'approval_status': 'approved',
                },
            )
        return len(lab_specs)

    # -- 5. Ambulance Drivers + Ambulances ------------------------
    def seed_drivers(self, hospitals):
        self._info("\n>> Seeding Ambulance Drivers")
        h1 = hospitals['KL-HOSP-001']

        driver_specs = [
            ('federcaresupport+driver1@gmail.com', 'Driver@Driv', 'Suresh Kumar', 'DL-KL-AMB-001',
             '9876500010', 'KL-01-AB-1234', 'advanced', 8.5300, 76.9400),
            ('federcaresupport+driver2@gmail.com', 'Driver@Driv', 'Manoj Thomas', 'DL-KL-AMB-002',
             '9876500011', 'KL-01-CD-5678', 'basic', 8.5100, 76.9200),
        ]

        for email, pwd, name, license_no, phone, vehicle_no, ambo_type, lat, lng in driver_specs:
            self._info(f"  * {name} ({vehicle_no})")
            login, _ = self._create_login(email=email, password=pwd, role='driver')
            driver, _ = AmbulanceDriverRegistration.objects.get_or_create(
                login_id=login,
                defaults={
                    'hospital_id': h1,
                    'full_name': name,
                    'license_no': license_no,
                    'phone': phone,
                    'is_available': True,
                    'approval_status': 'approved',
                },
            )
            ambo_defaults = {
                'hospital_id': h1, 'driver_id': driver,
                'ambulance_type': ambo_type, 'is_available': True,
            }
            if lat is not None and lng is not None:
                ambo_defaults['current_lat'] = Decimal(str(lat))
                ambo_defaults['current_lng'] = Decimal(str(lng))
            Ambulance.objects.get_or_create(
                vehicle_no=vehicle_no, defaults=ambo_defaults,
            )
        return len(driver_specs)

    # -- 6. Patients + EHR + Risk ---------------------------------
    def seed_patients(self):
        self._info("\n>> Seeding Patients")

        patient_specs = [
            {
                'email': 'federcaresupport+patient1@gmail.com', 'name': 'Arjun Menon',
                'dob': date(1990, 5, 15), 'gender': 'male', 'blood': 'O+',
                'height': 175, 'weight': 70,
                'address': 'Thiruvananthapuram, Kerala',
                'emergency_contact': '9876500020',
                'ehr': [
                    ('diagnosis', 'Hypertension', 'Hypertension diagnosed'),
                    ('prescription', 'Amlodipine', 'Amlodipine 5mg daily'),
                    ('history', 'Family history', 'Family history of diabetes'),
                ],
                'risk': {
                    'diabetes': 45.0, 'heart': 60.0,
                    'hypertension': 75.0, 'level': 'high',
                },
            },
            {
                'email': 'federcaresupport+patient2@gmail.com', 'name': 'Lakshmi Nair',
                'dob': date(1985, 8, 22), 'gender': 'female', 'blood': 'B+',
                'height': 162, 'weight': 65,
                'address': 'Kollam, Kerala',
                'emergency_contact': '9876500021',
                'ehr': [], 'risk': None,
            },
            {
                'email': 'federcaresupport+patient3@gmail.com', 'name': 'Mohammed Ashraf',
                'dob': date(1995, 3, 10), 'gender': 'male', 'blood': 'A+',
                'height': 170, 'weight': 75,
                'address': 'Kollam, Kerala',
                'emergency_contact': '9876500022',
                'ehr': [], 'risk': None,
            },
        ]

        patients = []
        for spec in patient_specs:
            self._info(f"  * {spec['name']}")
            login, _ = self._create_login(
                email=spec['email'], password='Patient@123', role='patient',
            )
            height_m = spec['height'] / 100
            bmi = round(spec['weight'] / (height_m * height_m), 2)

            patient, _ = PatientRegistration.objects.get_or_create(
                login_id=login,
                defaults={
                    'full_name': spec['name'],
                    'dob': spec['dob'],
                    'gender': spec['gender'],
                    'blood_group': spec['blood'],
                    'height_cm': Decimal(str(spec['height'])),
                    'weight_kg': Decimal(str(spec['weight'])),
                    'bmi': Decimal(str(bmi)),
                    'address': spec['address'],
                    'emergency_contact': spec['emergency_contact'],
                },
            )

            # EHR records
            for record_type, title, content in spec['ehr']:
                EHRRecord.objects.get_or_create(
                    patient_id=patient, record_type=record_type, title=title,
                    defaults={'content': content, 'added_by': login},
                )
            if spec['ehr']:
                self._info(f"      - {len(spec['ehr'])} EHR records")

            # Risk assessment
            if spec['risk']:
                r = spec['risk']
                RiskAssessment.objects.filter(patient_id=patient).delete()
                RiskAssessment.objects.create(
                    patient_id=patient,
                    risk_level=r['level'],
                    diabetes_risk=Decimal(str(r['diabetes'])),
                    heart_risk=Decimal(str(r['heart'])),
                    hypertension_risk=Decimal(str(r['hypertension'])),
                    recommendations='Regular checkups, lifestyle modification recommended.',
                )
                self._info("      - risk assessment recorded")

            patients.append(patient)
        return patients

    # -- 7. Pharmacies --------------------------------------------
    def seed_pharmacies(self):
        self._info("\n>> Seeding Pharmacies")

        specs = [
            ('federcaresupport+pharma1@gmail.com', 'MedPlus Pharmacy', 'PH-KL-001', 'Anil Kumar', 'Thiruvananthapuram, Kerala'),
            ('federcaresupport+pharma2@gmail.com',  'Apollo Pharmacy',  'PH-KL-002', 'Sreekumar P', 'Ayur, Kollam, Kerala'),
        ]
        for email, pname, license_no, full_name, addr in specs:
            self._info(f"  * {pname}")
            login, _ = self._create_login(email=email, password='Pharma@123', role='pharmacist')
            PharmacistRegistration.objects.get_or_create(
                login_id=login,
                defaults={
                    'pharmacy_name': pname,
                    'license_no': license_no,
                    'full_name': full_name,
                    'address': addr,
                    'approval_status': 'approved',
                },
            )
        return len(specs)

    # -- 7b. Pharmacy Inventory -----------------------------------
    def seed_pharmacy_inventory(self):
        self._info("\n>> Seeding Pharmacy Inventory")
        from apps.pharmacy.models import PharmacistRegistration, PharmacyInventory

        # (name, generic, category, price, stock, requires_rx, manufacturer)
        medplus = [
            ('Paracetamol 500mg', 'Acetaminophen', 'tablet', 2, 500, False, 'GSK'),
            ('Amoxicillin 500mg', 'Amoxicillin', 'capsule', 8, 200, True, 'Cipla'),
            ('Azithromycin 500mg', 'Azithromycin', 'tablet', 15, 150, True, 'Sun Pharma'),
            ('Cetirizine 10mg', 'Cetirizine', 'tablet', 3, 300, False, 'Dr Reddy'),
            ('Omeprazole 20mg', 'Omeprazole', 'capsule', 5, 250, False, 'Cipla'),
            ('Metformin 500mg', 'Metformin', 'tablet', 4, 200, True, 'USV'),
            ('Amlodipine 5mg', 'Amlodipine', 'tablet', 6, 180, True, 'Cipla'),
            ('Vitamin C 500mg', 'Ascorbic Acid', 'tablet', 5, 400, False, 'HealthVit'),
            ('Vitamin D3', 'Cholecalciferol', 'capsule', 12, 300, False, 'Mankind'),
            ('Ibuprofen 400mg', 'Ibuprofen', 'tablet', 4, 350, False, 'Abbott'),
            ('Cough Syrup', 'Dextromethorphan', 'syrup', 45, 100, False, 'Himalaya'),
            ('Antacid Syrup', 'Magaldrate', 'syrup', 35, 150, False, 'Pfizer'),
            ('Betadine Solution', 'Povidone Iodine', 'drops', 85, 80, False, 'Win-Medicare'),
            ('Diclofenac Gel', 'Diclofenac', 'cream', 60, 120, False, 'Novartis'),
            ('ORS Sachet', 'Oral Rehydration Salts', 'other', 10, 200, False, 'WHO Formula'),
        ]
        apollo = [
            ('Paracetamol 650mg', 'Acetaminophen', 'tablet', 3, 400, False, 'GSK'),
            ('Ciprofloxacin 500mg', 'Ciprofloxacin', 'tablet', 12, 100, True, 'Cipla'),
            ('Prednisolone 5mg', 'Prednisolone', 'tablet', 8, 150, True, 'Wyeth'),
            ('Loratadine 10mg', 'Loratadine', 'tablet', 6, 200, False, 'Bayer'),
            ('Pantoprazole 40mg', 'Pantoprazole', 'tablet', 8, 180, False, 'Sun Pharma'),
            ('Calcium + D3', 'Calcium Carbonate', 'tablet', 15, 250, False, 'Mankind'),
            ('Insulin Glargine', 'Insulin Glargine', 'injection', 450, 50, True, 'Sanofi'),
            ('Iron + Folic Acid', 'Ferrous Sulphate', 'tablet', 8, 300, False, 'Emcure'),
            ('Multivitamin', 'Multivitamin', 'tablet', 25, 200, False, 'Revital'),
            ('Hand Sanitizer', 'Isopropyl Alcohol', 'other', 50, 100, False, 'Dettol'),
        ]
        pharmacy_map = {
            'MedPlus Pharmacy': medplus,
            'Apollo Pharmacy': apollo,
        }

        created = 0
        for pname, medicines in pharmacy_map.items():
            pharmacy = PharmacistRegistration.objects.filter(pharmacy_name=pname).first()
            if not pharmacy:
                continue
            for name, generic, category, price, stock, rx, manufacturer in medicines:
                _, was_created = PharmacyInventory.objects.get_or_create(
                    pharmacy_id=pharmacy,
                    medicine_name=name,
                    defaults={
                        'generic_name': generic,
                        'category': category,
                        'price_per_unit': price,
                        'unit': category if category in ('tablet', 'capsule', 'syrup') else 'unit',
                        'stock_quantity': stock,
                        'reorder_level': 20,
                        'requires_prescription': rx,
                        'manufacturer': manufacturer,
                        'is_available': True,
                    },
                )
                if was_created:
                    created += 1
        self._ok(f"  Added {created} medicines across pharmacies")
        return created

    # -- 8. Vendors + Products ------------------------------------
    def seed_vendors(self):
        self._info("\n>> Seeding Vendors")

        vendor_specs = [
            {
                'email': 'federcaresupport+vendor1@gmail.com',
                'company': 'MedEquip Solutions',
                'tax_id': 'GST-KL-001',
                'contact': 'Vikram Singh',
                'phone': '9876500030',
                'products': [
                    ('Digital BP Monitor', 'Diagnostic', 2500.00, 20, 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80'),
                    ('Pulse Oximeter',     'Diagnostic', 1200.00, 15, 'https://images.unsplash.com/photo-1631815588090-d1bcbe9b4b38?w=400&q=80'),
                    ('Glucometer Kit',     'Diagnostic',  800.00, 30, 'https://images.unsplash.com/photo-1579154204601-01588f351e67?w=400&q=80'),
                    ('Surgical Scissors',  'Surgical',    350.00,  4, 'https://images.unsplash.com/photo-1551601651-09492b5468b6?w=400&q=80'),
                ],
            },
            {
                'email': 'federcaresupport+vendor2@gmail.com',
                'company': 'HealthTech Supplies',
                'tax_id': 'GST-KL-002',
                'contact': 'Anitha Raj',
                'phone': '9876500031',
                'products': [
                    ('ECG Machine',      'Diagnostic',  25000.00, 5, 'https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=400&q=80'),
                    ('Ultrasound Probe', 'Imaging',     15000.00, 3, 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=400&q=80'),
                    ('Nebulizer',        'Respiratory',  1800.00, 10, 'https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?w=400&q=80'),
                ],
            },
        ]

        product_count = 0
        for v in vendor_specs:
            self._info(f"  * {v['company']}")
            login, _ = self._create_login(
                email=v['email'], password='Vendor@123', role='vendor',
            )
            vendor, _ = VendorRegistration.objects.get_or_create(
                login_id=login,
                defaults={
                    'company_name': v['company'],
                    'tax_id': v['tax_id'],
                    'contact_name': v['contact'],
                    'phone': v['phone'],
                    'approval_status': 'approved',
                },
            )

            for pname, category, price, stock, image_url in v['products']:
                obj, created = EquipmentCatalog.objects.get_or_create(
                    vendor_id=vendor, product_name=pname,
                    defaults={
                        'category': category,
                        'price': Decimal(str(price)),
                        'stock_qty': stock,
                        'image_url': image_url,
                        'specifications': {'category': category},
                    },
                )
                if not created and not obj.image_url:
                    obj.image_url = image_url
                    obj.save(update_fields=['image_url'])
                product_count += 1
            self._info(f"      - {len(v['products'])} products")

        return len(vendor_specs), product_count

    # -- 9. Federated Learning data -------------------------------
    def seed_fl_data(self):
        self._info("\n>> Seeding Federated Learning data")

        global_model, _ = FLGlobalModel.objects.get_or_create(
            version='v1.0',
            defaults={
                'accuracy': Decimal('78.50'),
                'hospitals_count': 3,
                'is_active': True,
                'aggregation_algo': 'FedAvg',
            },
        )
        self._info(f"  * Global model {global_model.version} (accuracy {global_model.accuracy}%)")

        round_specs = [
            (1, Decimal('65.20')),
            (2, Decimal('71.80')),
            (3, Decimal('78.50')),
        ]

        for n, _accuracy in round_specs:
            FLRound.objects.get_or_create(
                model_id=global_model, round_number=n,
                defaults={
                    'status': 'completed',
                    'hospitals_invited': 3,
                    'hospitals_completed': 3,
                    'global_loss': Decimal('0.250000') / n,
                    'started_at': timezone.now() - timedelta(days=4 - n),
                    'completed_at': timezone.now() - timedelta(days=3 - n),
                },
            )
            self._info(f"      - Round {n} complete")
        return len(round_specs)

    # -- 10. Epidemic trends --------------------------------------
    def seed_epidemic_data(self):
        self._info("\n>> Seeding Epidemic Trends")
        today = date.today()

        specs = [
            ('Dengue', 'Kerala', 245, True, 'high'),
            ('Influenza', 'Thiruvananthapuram', 89, False, 'moderate'),
        ]
        for disease, region, count, spike, level in specs:
            EpidemicTrend.objects.get_or_create(
                disease_name=disease, region=region, recorded_date=today,
                defaults={
                    'case_count': count,
                    'spike_detected': spike,
                    'alert_level': level,
                },
            )
            self._info(f"  * {disease} in {region}: {count} cases [{level}]")
        return len(specs)

    # -- 11. Doctor slots for Dr. Rajesh -------------------------
    def seed_doctor_slots(self, doctors):
        self._info("\n>> Seeding Doctor Slots (Dr. Rajesh, tomorrow)")
        rajesh = next((d for d in doctors if d.full_name == 'Dr. Rajesh Kumar'), None)
        if not rajesh:
            self._warn("  Dr. Rajesh not found — skipping slots")
            return 0

        tomorrow = date.today() + timedelta(days=1)
        slot_hours = [9, 10, 11, 14, 15]
        created = 0
        for hour in slot_hours:
            _, was_created = DoctorSlot.objects.get_or_create(
                doctor_id=rajesh,
                slot_date=tomorrow,
                start_time=time(hour, 0),
                defaults={
                    'end_time': time(hour, 30),
                    'consult_type': 'online',
                    'is_booked': False,
                },
            )
            if was_created:
                created += 1
        self._info(f"  * {len(slot_hours)} slots prepared for {tomorrow} (created {created} new)")
        return len(slot_hours)

    # -- 12. Hospital Patients (FL training data) -----------------
    def seed_hospital_patients(self, hospitals):
        self._info("\n>> Seeding Hospital Patients (FL training data)")
        h1 = hospitals['KL-HOSP-001']
        h2 = hospitals['KL-HOSP-002']
        h3 = hospitals['KL-HOSP-003']
        h1_login = h1.login_id
        h2_login = h2.login_id
        h3_login = h3.login_id

        # (hospital, added_by, name, age, gender, blood, diagnosis, symptoms)
        patient_data = [
            # ── Hospital 1: City Medical Center (35 patients) ──────────────
            (h1, h1_login, 'Rahul Sharma', 45, 'male', 'O+', 'Diabetes',
             ['fatigue', 'weight_loss', 'restlessness', 'lethargy', 'irregular_sugar_level', 'polyuria', 'excessive_hunger']),
            (h1, h1_login, 'Priya Nair', 32, 'female', 'B+', 'Malaria',
             ['chills', 'vomiting', 'high_fever', 'sweating', 'headache', 'nausea', 'muscle_pain', 'fatigue']),
            (h1, h1_login, 'Arjun Krishnan', 28, 'male', 'A+', 'Dengue',
             ['skin_rash', 'headache', 'joint_pain', 'high_fever', 'loss_of_appetite', 'nausea', 'fatigue', 'red_spots_over_body']),
            (h1, h1_login, 'Meera Thomas', 38, 'female', 'AB+', 'Typhoid',
             ['chills', 'vomiting', 'high_fever', 'nausea', 'headache', 'constipation', 'abdominal_pain', 'fatigue']),
            (h1, h1_login, 'Suresh Kumar', 55, 'male', 'O-', 'Hypertension',
             ['headache', 'chest_pain', 'fatigue', 'lack_of_concentration', 'fast_heart_rate']),
            (h1, h1_login, 'Anjali Menon', 42, 'female', 'B-', 'Pneumonia',
             ['high_fever', 'cough', 'rusty_sputum', 'breathlessness', 'fatigue', 'chest_pain', 'phlegm']),
            (h1, h1_login, 'Vijay Pillai', 60, 'male', 'A-', 'Heart attack',
             ['chest_pain', 'breathlessness', 'nausea', 'sweating', 'fatigue', 'palpitations']),
            (h1, h1_login, 'Divya Rao', 25, 'female', 'O+', 'Common Cold',
             ['continuous_sneezing', 'shivering', 'runny_nose', 'congestion', 'throat_irritation', 'mild_fever', 'headache']),
            (h1, h1_login, 'Raju Varma', 35, 'male', 'B+', 'Migraine',
             ['headache', 'visual_disturbances', 'nausea', 'blurred_and_distorted_vision']),
            (h1, h1_login, 'Lakshmi Devi', 48, 'female', 'A+', 'Diabetes',
             ['fatigue', 'weight_loss', 'lethargy', 'irregular_sugar_level', 'polyuria', 'excessive_hunger', 'restlessness']),
            (h1, h1_login, 'Arun Nambiar', 52, 'male', 'O+', 'Tuberculosis',
             ['cough', 'weight_loss', 'blood_in_sputum', 'fatigue', 'breathlessness', 'sweating', 'high_fever']),
            (h1, h1_login, 'Sreeja Pillai', 29, 'female', 'AB-', 'Allergy',
             ['continuous_sneezing', 'skin_rash', 'watering_from_eyes', 'runny_nose', 'congestion', 'shivering']),
            (h1, h1_login, 'Mohan Das', 40, 'male', 'B+', 'GERD',
             ['stomach_pain', 'acidity', 'indigestion', 'nausea', 'vomiting']),
            (h1, h1_login, 'Radha Krishna', 33, 'female', 'O+', 'Fungal infection',
             ['itching', 'skin_rash', 'nodal_skin_eruptions', 'dischromic_patches']),
            (h1, h1_login, 'Sanjay Menon', 50, 'male', 'A+', 'Bronchial Asthma',
             ['fatigue', 'cough', 'breathlessness', 'phlegm', 'family_history', 'mucoid_sputum']),
            (h1, h1_login, 'Anitha George', 36, 'female', 'O-', 'Malaria',
             ['chills', 'vomiting', 'high_fever', 'sweating', 'headache', 'nausea', 'muscle_pain']),
            (h1, h1_login, 'Deepak Nair', 44, 'male', 'B+', 'Dengue',
             ['skin_rash', 'joint_pain', 'high_fever', 'loss_of_appetite', 'nausea', 'fatigue', 'red_spots_over_body', 'muscle_pain']),
            (h1, h1_login, 'Kavitha Pillai', 27, 'female', 'A+', 'Common Cold',
             ['continuous_sneezing', 'runny_nose', 'congestion', 'throat_irritation', 'mild_fever', 'shivering']),
            (h1, h1_login, 'Sreenivasan R', 65, 'male', 'O+', 'Hypertension',
             ['headache', 'chest_pain', 'fatigue', 'lack_of_concentration', 'fast_heart_rate', 'vision_blurring']),
            (h1, h1_login, 'Parvathy Nair', 41, 'female', 'B-', 'Typhoid',
             ['chills', 'vomiting', 'high_fever', 'nausea', 'headache', 'abdominal_pain', 'diarrhoea', 'fatigue']),
            (h1, h1_login, 'Raghu Kumar', 38, 'male', 'A-', 'Pneumonia',
             ['high_fever', 'cough', 'rusty_sputum', 'breathlessness', 'fatigue', 'phlegm', 'chest_pain']),
            (h1, h1_login, 'Sindhu Varma', 30, 'female', 'O+', 'Migraine',
             ['headache', 'nausea', 'blurred_and_distorted_vision', 'visual_disturbances', 'vomiting']),
            (h1, h1_login, 'Babu Thomas', 57, 'male', 'AB+', 'Diabetes',
             ['fatigue', 'weight_loss', 'restlessness', 'irregular_sugar_level', 'polyuria', 'excessive_hunger']),
            (h1, h1_login, 'Geetha Krishnan', 45, 'female', 'O+', 'Allergy',
             ['continuous_sneezing', 'skin_rash', 'watering_from_eyes', 'runny_nose', 'shivering']),
            (h1, h1_login, 'Ashok Kumar', 48, 'male', 'B+', 'Gastroenteritis',
             ['vomiting', 'sunken_eyes', 'dehydration', 'diarrhoea', 'fatigue']),
            (h1, h1_login, 'Roshni Pillai', 22, 'female', 'A+', 'Common Cold',
             ['continuous_sneezing', 'runny_nose', 'congestion', 'throat_irritation', 'headache', 'mild_fever']),
            (h1, h1_login, 'Krishnan Nair', 62, 'male', 'O-', 'Heart attack',
             ['chest_pain', 'breathlessness', 'nausea', 'sweating', 'palpitations', 'vomiting']),
            (h1, h1_login, 'Mala Varma', 35, 'female', 'B+', 'Fungal infection',
             ['itching', 'skin_rash', 'nodal_skin_eruptions', 'dischromic_patches', 'skin_peeling']),
            (h1, h1_login, 'Shyam Krishnan', 53, 'male', 'A+', 'Tuberculosis',
             ['cough', 'weight_loss', 'blood_in_sputum', 'fatigue', 'breathlessness', 'high_fever', 'sweating']),
            (h1, h1_login, 'Rekha Menon', 46, 'female', 'O+', 'Bronchial Asthma',
             ['fatigue', 'cough', 'breathlessness', 'phlegm', 'mucoid_sputum']),
            (h1, h1_login, 'Suresh Pillai', 39, 'male', 'B-', 'Malaria',
             ['chills', 'vomiting', 'high_fever', 'sweating', 'headache', 'nausea', 'fatigue']),
            (h1, h1_login, 'Annu Thomas', 26, 'female', 'A+', 'Dengue',
             ['skin_rash', 'headache', 'joint_pain', 'high_fever', 'loss_of_appetite', 'nausea']),
            (h1, h1_login, 'Praveen Kumar', 33, 'male', 'O+', 'GERD',
             ['stomach_pain', 'acidity', 'indigestion', 'nausea', 'loss_of_appetite']),
            (h1, h1_login, 'Divya Krishnan', 29, 'female', 'AB+', 'Diabetes',
             ['fatigue', 'weight_loss', 'restlessness', 'lethargy', 'irregular_sugar_level', 'polyuria']),
            (h1, h1_login, 'Vijayan Nair', 70, 'male', 'O+', 'Hypertension',
             ['headache', 'chest_pain', 'fatigue', 'fast_heart_rate', 'lack_of_concentration']),

            # ── Hospital 2: MRIT Hospital (32 patients) ─────────────────────
            (h2, h2_login, 'Rahul Varma', 42, 'male', 'A+', 'Diabetes',
             ['fatigue', 'weight_loss', 'lethargy', 'irregular_sugar_level', 'polyuria', 'excessive_hunger']),
            (h2, h2_login, 'Nimitha Krishnan', 28, 'female', 'O+', 'Dengue',
             ['skin_rash', 'headache', 'joint_pain', 'high_fever', 'loss_of_appetite', 'nausea', 'fatigue']),
            (h2, h2_login, 'Anil Kumar', 55, 'male', 'B+', 'Hypertension',
             ['headache', 'chest_pain', 'fatigue', 'lack_of_concentration', 'fast_heart_rate']),
            (h2, h2_login, 'Shobha Pillai', 35, 'female', 'AB+', 'Malaria',
             ['chills', 'vomiting', 'high_fever', 'sweating', 'headache', 'nausea', 'muscle_pain']),
            (h2, h2_login, 'Manoj Thomas', 48, 'male', 'O-', 'Pneumonia',
             ['high_fever', 'cough', 'rusty_sputum', 'breathlessness', 'fatigue', 'chest_pain']),
            (h2, h2_login, 'Remya Nair', 32, 'female', 'A-', 'Typhoid',
             ['chills', 'vomiting', 'high_fever', 'nausea', 'headache', 'constipation', 'abdominal_pain']),
            (h2, h2_login, 'Sathish Kumar', 60, 'male', 'B-', 'Heart attack',
             ['chest_pain', 'breathlessness', 'nausea', 'sweating', 'fatigue', 'palpitations']),
            (h2, h2_login, 'Amrutha Menon', 23, 'female', 'O+', 'Common Cold',
             ['continuous_sneezing', 'runny_nose', 'congestion', 'throat_irritation', 'mild_fever']),
            (h2, h2_login, 'Gopinath P', 45, 'male', 'A+', 'Migraine',
             ['headache', 'visual_disturbances', 'nausea', 'blurred_and_distorted_vision']),
            (h2, h2_login, 'Lekha Thomas', 38, 'female', 'B+', 'Arthritis',
             ['joint_pain', 'back_pain', 'neck_stiffness', 'fatigue', 'muscle_pain']),
            (h2, h2_login, 'Suresh Nair', 50, 'male', 'O+', 'Tuberculosis',
             ['cough', 'weight_loss', 'blood_in_sputum', 'fatigue', 'breathlessness', 'sweating']),
            (h2, h2_login, 'Sindhu Krishnan', 29, 'female', 'A+', 'Chicken pox',
             ['itching', 'skin_rash', 'high_fever', 'fatigue', 'mild_fever', 'red_spots_over_body', 'blister']),
            (h2, h2_login, 'Rajan Pillai', 40, 'male', 'AB-', 'Diabetes',
             ['fatigue', 'weight_loss', 'restlessness', 'irregular_sugar_level', 'polyuria']),
            (h2, h2_login, 'Ananya Nair', 27, 'female', 'O-', 'Dengue',
             ['skin_rash', 'joint_pain', 'high_fever', 'nausea', 'fatigue', 'muscle_pain', 'red_spots_over_body']),
            (h2, h2_login, 'Sreekumar V', 58, 'male', 'B+', 'Hypertension',
             ['headache', 'chest_pain', 'fatigue', 'fast_heart_rate', 'vision_blurring']),
            (h2, h2_login, 'Preethi Thomas', 34, 'female', 'A+', 'Common Cold',
             ['continuous_sneezing', 'runny_nose', 'congestion', 'throat_irritation', 'headache']),
            (h2, h2_login, 'Biju Varma', 47, 'male', 'O+', 'Malaria',
             ['chills', 'vomiting', 'high_fever', 'sweating', 'nausea', 'headache']),
            (h2, h2_login, 'Nisha Pillai', 36, 'female', 'B-', 'Gastroenteritis',
             ['vomiting', 'sunken_eyes', 'dehydration', 'diarrhoea', 'fatigue']),
            (h2, h2_login, 'Sajan Krishnan', 53, 'male', 'A-', 'Pneumonia',
             ['high_fever', 'cough', 'rusty_sputum', 'breathlessness', 'fatigue', 'phlegm']),
            (h2, h2_login, 'Asha Menon', 44, 'female', 'O+', 'Arthritis',
             ['joint_pain', 'back_pain', 'neck_stiffness', 'muscle_pain', 'fatigue']),
            (h2, h2_login, 'Vinod Kumar', 37, 'male', 'A+', 'Typhoid',
             ['chills', 'vomiting', 'high_fever', 'nausea', 'headache', 'diarrhoea', 'abdominal_pain']),
            (h2, h2_login, 'Deepa Nair', 31, 'female', 'B+', 'Migraine',
             ['headache', 'nausea', 'blurred_and_distorted_vision', 'vomiting']),
            (h2, h2_login, 'Rajiv Menon', 62, 'male', 'O-', 'Heart attack',
             ['chest_pain', 'breathlessness', 'nausea', 'sweating', 'palpitations']),
            (h2, h2_login, 'Sumathi Pillai', 41, 'female', 'A+', 'Chicken pox',
             ['itching', 'skin_rash', 'high_fever', 'fatigue', 'blister', 'red_spots_over_body']),
            (h2, h2_login, 'Arun Thomas', 30, 'male', 'B+', 'Gastroenteritis',
             ['vomiting', 'sunken_eyes', 'dehydration', 'diarrhoea', 'stomach_pain']),
            (h2, h2_login, 'Kavya Krishnan', 25, 'female', 'O+', 'Common Cold',
             ['continuous_sneezing', 'runny_nose', 'congestion', 'mild_fever', 'throat_irritation']),
            (h2, h2_login, 'Sudhir Kumar', 56, 'male', 'AB+', 'Diabetes',
             ['fatigue', 'weight_loss', 'lethargy', 'irregular_sugar_level', 'polyuria', 'excessive_hunger', 'restlessness']),
            (h2, h2_login, 'Rosamma Thomas', 49, 'female', 'O+', 'Tuberculosis',
             ['cough', 'weight_loss', 'blood_in_sputum', 'fatigue', 'breathlessness', 'high_fever']),
            (h2, h2_login, 'Siddharth Nair', 33, 'male', 'A-', 'Malaria',
             ['chills', 'vomiting', 'high_fever', 'sweating', 'headache', 'muscle_pain']),
            (h2, h2_login, 'Liji Varma', 39, 'female', 'B+', 'Pneumonia',
             ['high_fever', 'cough', 'breathlessness', 'fatigue', 'chest_pain', 'phlegm']),
            (h2, h2_login, 'Babu Krishnan', 52, 'male', 'O+', 'Hypertension',
             ['headache', 'chest_pain', 'fatigue', 'lack_of_concentration']),
            (h2, h2_login, 'Meghna Pillai', 28, 'female', 'A+', 'Dengue',
             ['skin_rash', 'headache', 'joint_pain', 'high_fever', 'nausea', 'fatigue']),

            # ── Hospital 3: Sunrise Healthcare (30 patients) ────────────────
            (h3, h3_login, 'Rajesh Nair', 48, 'male', 'O+', 'Diabetes',
             ['fatigue', 'weight_loss', 'restlessness', 'lethargy', 'irregular_sugar_level', 'polyuria', 'excessive_hunger']),
            (h3, h3_login, 'Anitha Pillai', 35, 'female', 'B+', 'Malaria',
             ['chills', 'vomiting', 'high_fever', 'sweating', 'headache', 'nausea', 'muscle_pain']),
            (h3, h3_login, 'Pramod Kumar', 40, 'male', 'A+', 'Hypertension',
             ['headache', 'chest_pain', 'fatigue', 'lack_of_concentration', 'fast_heart_rate']),
            (h3, h3_login, 'Sreelakshmi V', 28, 'female', 'O-', 'Dengue',
             ['skin_rash', 'headache', 'joint_pain', 'high_fever', 'loss_of_appetite', 'nausea']),
            (h3, h3_login, 'Jayakumar T', 55, 'male', 'AB+', 'Pneumonia',
             ['high_fever', 'cough', 'rusty_sputum', 'breathlessness', 'fatigue', 'chest_pain']),
            (h3, h3_login, 'Rekha Varma', 42, 'female', 'B-', 'Typhoid',
             ['chills', 'vomiting', 'high_fever', 'nausea', 'headache', 'constipation', 'abdominal_pain']),
            (h3, h3_login, 'Sathyanarayana P', 65, 'male', 'A-', 'Heart attack',
             ['chest_pain', 'breathlessness', 'nausea', 'sweating', 'fatigue', 'palpitations']),
            (h3, h3_login, 'Divya Menon', 26, 'female', 'O+', 'Common Cold',
             ['continuous_sneezing', 'runny_nose', 'congestion', 'throat_irritation', 'mild_fever', 'headache']),
            (h3, h3_login, 'Suresh Varma', 38, 'male', 'B+', 'GERD',
             ['stomach_pain', 'acidity', 'indigestion', 'nausea', 'loss_of_appetite']),
            (h3, h3_login, 'Bindu Thomas', 44, 'female', 'A+', 'Hepatitis B',
             ['fatigue', 'yellowish_skin', 'dark_urine', 'nausea', 'loss_of_appetite', 'vomiting', 'abdominal_pain', 'yellowing_of_eyes']),
            (h3, h3_login, 'Rajendran K', 52, 'male', 'O+', 'Hepatitis C',
             ['fatigue', 'yellowish_skin', 'dark_urine', 'nausea', 'loss_of_appetite', 'vomiting', 'yellowing_of_eyes']),
            (h3, h3_login, 'Sujatha Pillai', 39, 'female', 'B+', 'Jaundice',
             ['yellowish_skin', 'dark_urine', 'nausea', 'loss_of_appetite', 'vomiting', 'abdominal_pain', 'fatigue', 'yellowing_of_eyes']),
            (h3, h3_login, 'Krishnamurthy A', 47, 'male', 'AB+', 'Diabetes',
             ['fatigue', 'weight_loss', 'lethargy', 'irregular_sugar_level', 'polyuria', 'restlessness']),
            (h3, h3_login, 'Sreeja Krishnan', 31, 'female', 'O+', 'Urinary tract infection',
             ['burning_micturition', 'spotting_urination', 'fatigue', 'chills', 'high_fever']),
            (h3, h3_login, 'Manoj Varma', 44, 'male', 'A-', 'Malaria',
             ['chills', 'vomiting', 'high_fever', 'sweating', 'headache', 'nausea', 'fatigue']),
            (h3, h3_login, 'Asha Nair', 36, 'female', 'B+', 'Common Cold',
             ['continuous_sneezing', 'runny_nose', 'congestion', 'throat_irritation', 'shivering', 'mild_fever']),
            (h3, h3_login, 'Sreenath K', 58, 'male', 'O+', 'Tuberculosis',
             ['cough', 'weight_loss', 'blood_in_sputum', 'fatigue', 'breathlessness', 'sweating', 'high_fever']),
            (h3, h3_login, 'Parvathy Thomas', 29, 'female', 'A+', 'GERD',
             ['stomach_pain', 'acidity', 'indigestion', 'nausea', 'vomiting']),
            (h3, h3_login, 'Girish Kumar', 50, 'male', 'B-', 'Hepatitis B',
             ['fatigue', 'yellowish_skin', 'dark_urine', 'nausea', 'loss_of_appetite', 'abdominal_pain', 'yellowing_of_eyes']),
            (h3, h3_login, 'Nisha Menon', 33, 'female', 'O-', 'Urinary tract infection',
             ['burning_micturition', 'spotting_urination', 'fatigue', 'chills', 'high_fever']),
            (h3, h3_login, 'Raghunath Pillai', 61, 'male', 'A+', 'Hypertension',
             ['headache', 'chest_pain', 'fatigue', 'fast_heart_rate', 'lack_of_concentration']),
            (h3, h3_login, 'Sumita Varma', 38, 'female', 'O+', 'Jaundice',
             ['yellowish_skin', 'dark_urine', 'nausea', 'fatigue', 'loss_of_appetite', 'yellowing_of_eyes']),
            (h3, h3_login, 'Suresh Thomas', 45, 'male', 'B+', 'Common Cold',
             ['continuous_sneezing', 'runny_nose', 'congestion', 'mild_fever', 'throat_irritation', 'headache']),
            (h3, h3_login, 'Sreelatha Nair', 27, 'female', 'A+', 'Dengue',
             ['skin_rash', 'joint_pain', 'high_fever', 'nausea', 'fatigue', 'red_spots_over_body']),
            (h3, h3_login, 'Santhosh Thomas', 35, 'male', 'O+', 'Typhoid',
             ['chills', 'vomiting', 'high_fever', 'nausea', 'headache', 'abdominal_pain', 'diarrhoea']),
            (h3, h3_login, 'Meera Krishnan', 42, 'female', 'AB-', 'Hepatitis C',
             ['fatigue', 'yellowish_skin', 'dark_urine', 'nausea', 'loss_of_appetite', 'yellowing_of_eyes']),
            (h3, h3_login, 'Prakashan V', 53, 'male', 'B+', 'Tuberculosis',
             ['cough', 'weight_loss', 'fatigue', 'breathlessness', 'blood_in_sputum', 'high_fever']),
            (h3, h3_login, 'Deepika Pillai', 30, 'female', 'O+', 'Malaria',
             ['chills', 'vomiting', 'high_fever', 'sweating', 'headache', 'nausea']),
            (h3, h3_login, 'Vijayakumar K', 47, 'male', 'A+', 'Diabetes',
             ['fatigue', 'weight_loss', 'restlessness', 'irregular_sugar_level', 'polyuria', 'lethargy']),
            (h3, h3_login, 'Liji Thomas', 37, 'female', 'B+', 'Pneumonia',
             ['high_fever', 'cough', 'breathlessness', 'fatigue', 'chest_pain', 'phlegm']),
        ]

        created = 0
        for hospital, added_by, name, age, gender, blood, diagnosis, symptoms in patient_data:
            _, was_created = HospitalPatient.objects.get_or_create(
                hospital_id=hospital,
                full_name=name,
                diagnosis=diagnosis,
                defaults={
                    'added_by': added_by,
                    'age': age,
                    'gender': gender,
                    'blood_group': blood,
                    'symptoms': symptoms,
                },
            )
            if was_created:
                created += 1

        h1_count = HospitalPatient.objects.filter(hospital_id=h1).count()
        h2_count = HospitalPatient.objects.filter(hospital_id=h2).count()
        h3_count = HospitalPatient.objects.filter(hospital_id=h3).count()
        self._info(f"  * City Medical Center: {h1_count} patients")
        self._info(f"  * MRIT Hospital: {h2_count} patients")
        self._info(f"  * Sunrise Healthcare: {h3_count} patients")
        return HospitalPatient.objects.count()

    # -- final credentials block ----------------------------------
    def _print_credentials(self):
        W = "=" * 44
        self._info(f"\n{W}")
        self._ok("FEDERCARE DEMO CREDENTIALS")
        self._info(W)

        self._info("\nSUPER ADMIN:")
        self._ok("  Email   : federcaresupport@gmail.com")
        self._ok("  Password: Admin@123")

        self._info("\nHOSPITALS:")
        self._info("  City Medical Center:")
        self._info("    federcaresupport+hospital1@gmail.com")
        self._info("    Hospital@123")
        self._info("  MRIT Hospital:")
        self._info("    federcaresupport+hospital2@gmail.com")
        self._info("    Hospital@123")
        self._info("  Sunrise Healthcare:")
        self._info("    federcaresupport+hospital3@gmail.com")
        self._info("    Hospital@123")

        self._info("\nDOCTORS:")
        self._info("  Dr. Rajesh Kumar (Cardiology):")
        self._info("    federcaresupport+doctor1@gmail.com")
        self._info("    Doctor@Raja")
        self._info("  Dr. Priya Sharma (General Medicine):")
        self._info("    federcaresupport+doctor2@gmail.com")
        self._info("    Doctor@Priy")
        self._info("  Dr. Arun Nair (Neurology):")
        self._info("    federcaresupport+doctor3@gmail.com")
        self._info("    Doctor@Arun")
        self._info("  Dr. Meera Pillai (General Medicine):")
        self._info("    federcaresupport+doctor4@gmail.com")
        self._info("    Doctor@Meer")

        self._info("\nLAB TECHNICIANS:")
        self._info("  Ravi Krishnan:")
        self._info("    federcaresupport+lab1@gmail.com")
        self._info("    Lab@Lab1")
        self._info("  Sreeja Mohan:")
        self._info("    federcaresupport+lab2@gmail.com")
        self._info("    Lab@Lab2")

        self._info("\nDRIVERS:")
        self._info("  Suresh Kumar:")
        self._info("    federcaresupport+driver1@gmail.com")
        self._info("    Driver@Driv")
        self._info("  Manoj Thomas:")
        self._info("    federcaresupport+driver2@gmail.com")
        self._info("    Driver@Driv")

        self._info("\nPATIENTS:")
        self._info("  Arjun Menon:")
        self._info("    federcaresupport+patient1@gmail.com")
        self._info("    Patient@123")
        self._info("  Lakshmi Nair:")
        self._info("    federcaresupport+patient2@gmail.com")
        self._info("    Patient@123")
        self._info("  Mohammed Ashraf:")
        self._info("    federcaresupport+patient3@gmail.com")
        self._info("    Patient@123")

        self._info("\nPHARMACISTS:")
        self._info("  MedPlus Pharmacy:")
        self._info("    federcaresupport+pharma1@gmail.com")
        self._info("    Pharma@123")
        self._info("  Apollo Pharmacy:")
        self._info("    federcaresupport+pharma2@gmail.com")
        self._info("    Pharma@123")

        self._info("\nVENDORS:")
        self._info("  MedEquip Solutions:")
        self._info("    federcaresupport+vendor1@gmail.com")
        self._info("    Vendor@123")
        self._info("  HealthTech Supplies:")
        self._info("    federcaresupport+vendor2@gmail.com")
        self._info("    Vendor@123")

        self._info(f"\n{W}")
        self._ok("ALL EMAILS DELIVER TO: federcaresupport@gmail.com")
        self._info(W)
        self._ok("[OK] Seed complete. Run `python manage.py runserver` to start.")
