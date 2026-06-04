"""ML utilities for the AI engine. Always tries to load a trained .pkl model first,
then falls back to deterministic rule-based logic if no model is present."""
import os
import logging
from collections import Counter

logger = logging.getLogger(__name__)

ML_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ml_models'))

# Module-level cache so .pkl files are loaded once per process.
_CACHE = {}


def _normalize_symptom(s):
    """Canonicalize a symptom to the underscore form used by the trained vocabulary.

    Handles spaces, underscores and hyphens so frontend labels like
    "High Fever", "high-fever" or "high_fever" all map to "high_fever".
    """
    if s is None:
        return None
    s = str(s).strip().lower()
    s = s.replace('_', ' ').replace('-', ' ')
    s = '_'.join(part for part in s.split() if part)
    return s or None

SYMPTOM_DISEASE_MAP = {
    'fever': ['Malaria', 'Typhoid', 'Dengue', 'Flu'],
    'cough': ['Tuberculosis', 'Bronchitis', 'Pneumonia', 'COVID-19'],
    'headache': ['Migraine', 'Hypertension', 'Meningitis'],
    'chest_pain': ['Heart Attack', 'Angina', 'Costochondritis'],
    'breathlessness': ['Asthma', 'Pneumonia', 'Heart Failure'],
    'fatigue': ['Anemia', 'Diabetes', 'Hypothyroidism'],
    'nausea': ['Gastritis', 'Food Poisoning', 'Appendicitis'],
    'joint_pain': ['Arthritis', 'Gout', 'Lupus'],
    'skin_rash': ['Chickenpox', 'Measles', 'Allergy', 'Psoriasis'],
    'abdominal_pain': ['Appendicitis', 'Gastritis', 'IBS', 'Ulcer'],
    'dizziness': ['Vertigo', 'Hypertension', 'Anemia'],
    'weight_loss': ['Diabetes', 'Tuberculosis', 'Cancer'],
    'frequent_urination': ['Diabetes', 'UTI', 'Kidney Disease'],
    'back_pain': ['Kidney Stones', 'Muscle Strain', 'Disc Herniation'],
    'swollen_lymph_nodes': ['Infection', 'Lymphoma', 'Mononucleosis'],
}

CRITICAL_SYMPTOMS = ['chest_pain', 'breathlessness', 'unconscious']
HIGH_SYMPTOMS = ['fever', 'severe_headache', 'vomiting_blood']

SEVERITY_RECOMMENDATION = {
    'critical': 'Call emergency immediately. Go to ER now.',
    'high': 'Visit hospital today. Do not delay.',
    'moderate': 'Consult a doctor within 24 hours.',
    'low': 'Rest and monitor. See doctor if worsens.',
}

RECOMMENDED_TESTS_MAP = {
    'Diabetes': ['HbA1c', 'Fasting Blood Sugar', 'Urine Sugar'],
    'Heart Attack': ['ECG', 'Troponin', 'Echo'],
    'Tuberculosis': ['Chest X-Ray', 'Sputum Culture', 'Mantoux Test'],
    'Malaria': ['Blood Smear', 'RDT', 'CBC'],
    'Dengue': ['NS1 Antigen', 'Platelet Count', 'CBC'],
    'Anemia': ['CBC', 'Iron Studies', 'B12 Level'],
    'Kidney Disease': ['Creatinine', 'BUN', 'Urine Routine'],
    'Liver Disease': ['LFT', 'Bilirubin', 'Ultrasound'],
    'Hypertension': ['BP Monitoring', 'ECG', 'Kidney Function'],
    'Pneumonia': ['Chest X-Ray', 'Sputum Culture', 'CBC'],
    # Names from the trained 41-disease model (Kaggle symptom-disease dataset)
    'Typhoid': ['Widal Test', 'Blood Culture', 'CBC'],
    'Common Cold': ['Clinical Examination', 'Throat Swab'],
    'Bronchial Asthma': ['PFT', 'Spirometry', 'Peak Flow'],
    'Chicken pox': ['PCR Test', 'Tzanck Smear'],
    'Hepatitis A': ['LFT', 'Anti-HAV IgM', 'Bilirubin'],
    'Hepatitis B': ['HBsAg', 'LFT', 'HBV DNA'],
    'Hepatitis C': ['Anti-HCV', 'HCV RNA', 'LFT'],
    'Hepatitis D': ['Anti-HDV', 'LFT'],
    'Hepatitis E': ['Anti-HEV IgM', 'LFT'],
    'Alcoholic hepatitis': ['LFT', 'GGT', 'Ultrasound'],
    'Jaundice': ['LFT', 'Bilirubin', 'Ultrasound'],
    'Migraine': ['MRI', 'Neurological Exam'],
    'GERD': ['Endoscopy', 'pH Monitoring'],
    'Gastroenteritis': ['Stool Culture', 'CBC'],
    'Drug Reaction': ['Allergy Panel', 'CBC', 'LFT'],
    'Fungal infection': ['KOH Mount', 'Skin Scraping'],
    'Allergy': ['Allergy Panel', 'IgE Test'],
    'Acne': ['Clinical Examination', 'Hormone Panel'],
    'Psoriasis': ['Skin Biopsy', 'Clinical Examination'],
    'Impetigo': ['Skin Swab', 'Bacterial Culture'],
    'Arthritis': ['ESR', 'CRP', 'Rheumatoid Factor'],
    'Osteoarthritis': ['X-Ray', 'MRI'],
    'Cervical spondylosis': ['MRI', 'X-Ray Cervical Spine'],
    'Paralysis (brain hemorrhage)': ['CT Brain', 'MRI Brain'],
    'Hyperthyroidism': ['TSH', 'T3', 'T4', 'Thyroid Antibodies'],
    'Hypothyroidism': ['TSH', 'T3', 'T4'],
    'Hypoglycemia': ['Blood Glucose', 'Insulin Level'],
    'Urinary tract infection': ['Urine Routine', 'Urine Culture'],
    'Dimorphic hemmorhoids(piles)': ['Proctoscopy', 'Sigmoidoscopy'],
    '(vertigo) Paroymsal  Positional Vertigo': ['Dix-Hallpike Test', 'MRI Brain'],
    'AIDS': ['HIV ELISA', 'CD4 Count', 'Western Blot'],
    'Peptic ulcer diseae': ['Endoscopy', 'H. pylori Test'],
    'Chronic cholestasis': ['LFT', 'Ultrasound', 'MRCP'],
    'Varicose veins': ['Doppler Ultrasound', 'Venography'],
}

# Case-insensitive lookup index built once
_TESTS_CI_INDEX = {k.lower(): v for k, v in RECOMMENDED_TESTS_MAP.items()}


def known_symptoms():
    """Return the canonical sorted symptoms list for the frontend selector.

    Prefers the trained vocabulary (133+ symptoms from symptom_severity.csv) if
    available; otherwise falls back to the rule-based subset.
    """
    trained = _load_pickle('symptom_list.pkl')
    if trained:
        return sorted(set(trained))
    symptoms = set(SYMPTOM_DISEASE_MAP.keys()) | set(CRITICAL_SYMPTOMS) | set(HIGH_SYMPTOMS)
    return sorted(symptoms)


# ─── Model loading (cached) ─────────────────────────────────────────────────

def load_model(model_path):
    """Try to load a .pkl model with joblib. Return None if not found / load fails."""
    if model_path in _CACHE:
        return _CACHE[model_path]
    try:
        if not os.path.exists(model_path):
            _CACHE[model_path] = None
            return None
        import joblib
        _CACHE[model_path] = joblib.load(model_path)
        logger.info('Loaded ML artifact: %s', os.path.basename(model_path))
        return _CACHE[model_path]
    except Exception as exc:
        logger.warning('Failed to load model %s: %s', model_path, exc)
        _CACHE[model_path] = None
        return None


def _load_pickle(filename):
    return load_model(os.path.join(ML_DIR, filename))


def _build_feature_vector(input_symptoms, vocabulary):
    """Build a binary vector of length len(vocabulary) from normalized input symptoms.

    Both the input symptoms and the vocabulary words are normalized before
    comparison, so a spaces/underscores/hyphens mismatch can never zero out
    the whole vector (which would make the model return a uniform guess).
    """
    normalized = {_normalize_symptom(s) for s in input_symptoms}
    normalized.discard(None)
    return [1 if _normalize_symptom(sym) in normalized else 0 for sym in vocabulary]


def _decode_classes(model_classes, label_encoder):
    """Convert numeric class ids back to disease name strings."""
    if label_encoder is not None:
        try:
            return list(label_encoder.inverse_transform(model_classes))
        except Exception:
            pass
    return [str(c) for c in model_classes]


# ─── Severity helpers ───────────────────────────────────────────────────────

def _classify_severity(symptoms_list):
    if any(s in CRITICAL_SYMPTOMS for s in symptoms_list):
        return 'critical'
    if len(symptoms_list) >= 5:
        return 'high'
    if len(symptoms_list) >= 3:
        return 'moderate'
    return 'low'


# ─── 1. Symptom Checker ─────────────────────────────────────────────────────

def predict_symptoms(symptoms_list):
    """Predict top diseases from a list of symptom strings.

    Tries the trained LR model at ml_models/symptom_checker_lr.pkl; falls back to
    rule-based aggregation over SYMPTOM_DISEASE_MAP.
    """
    model_used = 'rule_based'
    predicted = []

    model = _load_pickle('symptom_checker_lr.pkl')
    vocabulary = _load_pickle('symptom_list.pkl')
    label_encoder = _load_pickle('disease_labels.pkl')

    if model is not None and vocabulary:
        try:
            import numpy as np
            vector = _build_feature_vector(symptoms_list, vocabulary)
            arr = np.array(vector).reshape(1, -1)
            proba = model.predict_proba(arr)[0]
            class_names = _decode_classes(model.classes_, label_encoder)
            top_idx = sorted(range(len(proba)), key=lambda i: proba[i], reverse=True)[:3]
            predicted = [
                {'disease': str(class_names[i]), 'probability': round(float(proba[i]) * 100, 1)}
                for i in top_idx if proba[i] > 0.005
            ]
            if predicted:
                model_used = 'ml_model'
        except Exception as exc:
            logger.warning('LR model inference failed, falling back: %s', exc)

    if not predicted:
        # Rule-based: count disease mentions across all symptoms, take top 3
        counter = Counter()
        for symptom in symptoms_list:
            for disease in SYMPTOM_DISEASE_MAP.get(symptom, []):
                counter[disease] += 1
        if not counter:
            counter['Common Cold'] = 1

        total = sum(counter.values())
        top = counter.most_common(3)
        predicted = [
            {'disease': disease, 'probability': round((count / total) * 90 + 5, 1)}
            for disease, count in top
        ]

    severity = _classify_severity(symptoms_list)
    recommendation = SEVERITY_RECOMMENDATION[severity]
    emergency_triggered = severity in ('critical', 'high')

    return {
        'predicted_diseases': predicted,
        'severity': severity,
        'recommendation': recommendation,
        'emergency_triggered': emergency_triggered,
        'model_used': model_used,
    }


# ─── 2. Clinical Diagnosis ──────────────────────────────────────────────────

_HIGH_SEVERITY_DISEASES = {
    'heart attack', 'aids', 'tuberculosis', 'hepatitis b', 'hepatitis c',
    'hepatitis d', 'hepatitis e', 'paralysis (brain hemorrhage)',
    'alcoholic hepatitis', 'jaundice',
}
_MEDIUM_SEVERITY_DISEASES = {
    'diabetes', 'hypertension', 'pneumonia', 'dengue', 'malaria', 'typhoid',
    'bronchial asthma', 'migraine', 'gerd', 'arthritis', 'hyperthyroidism',
    'hypothyroidism', 'cervical spondylosis', 'chicken pox',
}

_DISEASE_DESCRIPTION = {
    'diabetes': 'Metabolic disorder affecting blood sugar levels',
    'heart attack': 'Blockage of blood flow to heart muscle',
    'tuberculosis': 'Bacterial infection primarily affecting lungs',
    'malaria': 'Parasitic infection transmitted by mosquitoes',
    'dengue': 'Viral infection transmitted by Aedes mosquitoes',
    'pneumonia': 'Infection causing inflammation of lung air sacs',
    'hypertension': 'Persistently elevated blood pressure',
    'typhoid': 'Bacterial infection from contaminated food or water',
    'migraine': 'Recurrent moderate-to-severe headaches',
    'bronchial asthma': 'Chronic inflammatory airway disease',
    'gerd': 'Acid reflux from stomach into the oesophagus',
    'fungal infection': 'Skin or systemic infection caused by fungi',
    'allergy': 'Immune reaction to an otherwise harmless substance',
}


def get_disease_severity(disease):
    name = str(disease).strip().lower()
    if name in _HIGH_SEVERITY_DISEASES:
        return 'HIGH'
    if name in _MEDIUM_SEVERITY_DISEASES:
        return 'MEDIUM'
    return 'LOW'


def get_disease_description(disease):
    return _DISEASE_DESCRIPTION.get(
        str(disease).strip().lower(),
        'Please consult doctor for details.',
    )


def _enrich_diagnoses(diagnoses):
    """Attach severity / recommended tests / description to each diagnosis dict."""
    for d in diagnoses:
        d['severity'] = get_disease_severity(d['disease'])
        d['recommended_tests'] = _TESTS_CI_INDEX.get(d['disease'].lower(), ['CBC', 'Urine Routine'])
        d['description'] = get_disease_description(d['disease'])
    return diagnoses


def clinical_diagnosis(symptoms_list, patient_history=None):
    """Doctor-side AI diagnosis. Returns top diagnoses with confidence + recommended tests.

    Confidence is renormalized across the top-5 so the percentages are
    distinct and interpretable rather than the raw (near-uniform) RF priors.
    """
    patient_history = patient_history or {}
    model_used = 'rule_based'
    diagnoses = []

    model = _load_pickle('clinical_diagnosis_rf.pkl')
    vocabulary = _load_pickle('symptom_list.pkl')
    label_encoder = _load_pickle('disease_labels.pkl')

    if model is not None and vocabulary:
        try:
            import numpy as np
            vector = _build_feature_vector(symptoms_list, vocabulary)
            # All-zero vector → the model can only return its uniform prior
            # (every disease the same %). Skip the model and use the rule map.
            if sum(vector) == 0:
                logger.info('No symptoms matched the model vocabulary — using rule-based map.')
            else:
                arr = np.array(vector).reshape(1, -1)
                proba = model.predict_proba(arr)[0]
                class_names = _decode_classes(model.classes_, label_encoder)
                top_idx = sorted(range(len(proba)), key=lambda i: proba[i], reverse=True)[:5]
                raw = [(str(class_names[i]), float(proba[i])) for i in top_idx if proba[i] > 0]
                total = sum(p for _, p in raw)
                if raw and total > 0:
                    diagnoses = [
                        {'disease': name, 'confidence': round(p / total * 100, 1)}
                        for name, p in raw
                    ]
                    model_used = 'ml_model'
        except Exception as exc:
            logger.warning('RF diagnosis model failed, falling back: %s', exc)

    if not diagnoses:
        counter = Counter()
        for symptom in symptoms_list:
            for disease in SYMPTOM_DISEASE_MAP.get(_normalize_symptom(symptom), []):
                counter[disease] += 1
        if not counter:
            counter['Undifferentiated Illness'] = 1

        total = sum(counter.values())
        top = counter.most_common(5)
        diagnoses = [
            {'disease': disease, 'confidence': round((count / total) * 100, 1)}
            for disease, count in top
        ]

    _enrich_diagnoses(diagnoses)

    # Recommended tests — union of test sets for the top diagnoses (case-insensitive)
    recommended_tests = []
    seen = set()
    for d in diagnoses:
        tests = _TESTS_CI_INDEX.get(d['disease'].lower(), [])
        for test in tests:
            if test not in seen:
                recommended_tests.append(test)
                seen.add(test)

    # Risk flags
    risk_flags = []
    if any(s in CRITICAL_SYMPTOMS for s in symptoms_list):
        risk_flags.append('Critical symptom present — consider immediate ER referral.')
    if len(symptoms_list) >= 6:
        risk_flags.append('Multi-symptom presentation — rule out systemic infection or polymorbidity.')
    if patient_history.get('age', 0) >= 65:
        risk_flags.append('Geriatric patient — atypical presentations possible.')
    if patient_history.get('chronic_conditions'):
        risk_flags.append('Pre-existing chronic conditions on record — review interactions.')

    return {
        'top_diagnoses': diagnoses,
        'recommended_tests': recommended_tests,
        'risk_flags': risk_flags,
        'model_used': model_used,
    }


# ─── 3. Health Risk Predictor ───────────────────────────────────────────────

def predict_health_risk(patient_data):
    """Predict diabetes / heart / hypertension risks. Tries RF model, then rule-based."""
    model_used = 'rule_based'
    overall_level = None

    model = _load_pickle('risk_predictor_rf.pkl')
    feature_order = _load_pickle('risk_features.pkl') or [
        'age', 'bmi', 'blood_pressure_systolic', 'glucose_level', 'cholesterol',
    ]

    # Always compute the rule-based per-condition breakdown so the patient sees
    # differentiated diabetes / heart / hypertension scores. The trained model
    # provides a more reliable overall_level.
    diabetes_risk = _diabetes_risk_rule(patient_data)
    heart_risk = _heart_risk_rule(patient_data)
    hypertension_risk = _hypertension_risk_rule(patient_data)

    if model is not None:
        try:
            import numpy as np
            features = [float(patient_data.get(k, 0) or 0) for k in feature_order]
            arr = np.array(features).reshape(1, -1)
            pred_class = int(model.predict(arr)[0])
            level_map = {0: 'low', 1: 'moderate', 2: 'high'}
            overall_level = level_map.get(pred_class)
            model_used = 'ml_model'
        except Exception as exc:
            logger.warning('Risk model inference failed, falling back: %s', exc)

    if overall_level is None:
        max_risk = max(diabetes_risk, heart_risk, hypertension_risk)
        if max_risk > 70:
            overall_level = 'high'
        elif max_risk > 40:
            overall_level = 'moderate'
        else:
            overall_level = 'low'

    recommendations = _build_risk_recommendations(
        diabetes_risk, heart_risk, hypertension_risk, overall_level, patient_data
    )

    return {
        'diabetes_risk': diabetes_risk,
        'heart_risk': heart_risk,
        'hypertension_risk': hypertension_risk,
        'overall_level': overall_level,
        'recommendations': recommendations,
        'model_used': model_used,
    }


def _diabetes_risk_rule(p):
    score = 0
    if p.get('glucose_level', 0) > 100: score += 30
    if p.get('bmi', 0) > 25: score += 20
    if p.get('age', 0) > 45: score += 15
    if p.get('family_history_diabetes'): score += 25
    if not p.get('exercise'): score += 10
    return float(min(score, 95))


def _heart_risk_rule(p):
    score = 0
    if p.get('blood_pressure_systolic', 0) > 130: score += 25
    if p.get('cholesterol', 0) > 200: score += 20
    if p.get('smoking'): score += 30
    if p.get('age', 0) > 50: score += 15
    if p.get('family_history_heart'): score += 10
    return float(min(score, 95))


def _hypertension_risk_rule(p):
    score = 0
    if p.get('blood_pressure_systolic', 0) > 120: score += 30
    if p.get('bmi', 0) > 30: score += 20
    if p.get('age', 0) > 40: score += 15
    if not p.get('exercise'): score += 15
    if p.get('smoking'): score += 20
    return float(min(score, 95))


def _build_risk_recommendations(diabetes, heart, hypertension, level, p):
    recs = []
    if diabetes >= 50:
        recs.append('Get an HbA1c test soon and reduce refined carbohydrate intake.')
    elif diabetes >= 30:
        recs.append('Monitor blood glucose periodically and watch sugar intake.')

    if heart >= 50:
        recs.append('Schedule a cardiology consultation and start a heart-healthy diet.')
    elif heart >= 30:
        recs.append('Reduce saturated fat and get cholesterol checked annually.')

    if hypertension >= 50:
        recs.append('Begin daily blood pressure monitoring; reduce sodium intake.')
    elif hypertension >= 30:
        recs.append('Limit sodium and manage stress to keep blood pressure in check.')

    if p.get('smoking'):
        recs.append('Quit smoking — the single most impactful change you can make.')
    if not p.get('exercise'):
        recs.append('Add at least 150 minutes of moderate exercise per week.')

    if level == 'high':
        recs.append('Book a comprehensive health check-up within the week.')
    elif level == 'moderate':
        recs.append('Schedule a routine check-up within the next month.')
    else:
        recs.append('Maintain your current healthy lifestyle.')
    return recs
