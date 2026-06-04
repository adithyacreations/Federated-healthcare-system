"""FederCare ML Training Script

Trains all three production models from real Kaggle datasets:
  1. symptom_checker_lr.pkl    -- Logistic Regression on Symptom-Disease
  2. clinical_diagnosis_rf.pkl -- Random Forest on Symptom-Disease
  3. risk_predictor_rf.pkl     -- Random Forest on Diabetes + Heart Disease

Run from the ml_models/ directory:
    cd ml_models
    python train_models.py
"""
import os
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder


HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, 'datasets')
OUT_DIR = HERE


def banner(title):
    print('\n' + '=' * 70)
    print(f'  {title}')
    print('=' * 70)


# ─── Symptom feature engineering ─────────────────────────────────────────────

def _normalize_symptom(s):
    """Normalize a symptom string: lower, strip, internal whitespace -> single underscore."""
    if pd.isna(s):
        return None
    s = str(s).strip().lower()
    # Collapse internal spaces and mixed underscore/space tokens (e.g. "dischromic _patches")
    s = '_'.join(part for part in s.replace('_', ' ').split() if part)
    return s or None


def load_symptom_disease():
    """Load symptom_disease.csv and build a binary feature matrix.

    Returns: (X, y, feature_columns, label_encoder, raw_classes)
    """
    df = pd.read_csv(os.path.join(DATA_DIR, 'symptom_disease.csv'))
    df.columns = [c.strip() for c in df.columns]

    # Strip whitespace from string values
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].astype(str).str.strip()

    df['Disease'] = df['Disease'].str.strip()

    symptom_cols = [c for c in df.columns if c.lower().startswith('symptom_')]

    # Build canonical symptom vocabulary by union of symptom_severity.csv + observed values
    severity_path = os.path.join(DATA_DIR, 'symptom_severity.csv')
    symptom_severity = pd.read_csv(severity_path)
    symptom_severity.columns = [c.strip() for c in symptom_severity.columns]
    severity_symptoms = {_normalize_symptom(s) for s in symptom_severity['Symptom']}

    observed = set()
    for col in symptom_cols:
        observed.update(_normalize_symptom(s) for s in df[col].dropna().unique())

    vocabulary = sorted(s for s in (severity_symptoms | observed) if s and s.lower() != 'nan')

    # Build a binary matrix: rows = patient cases, cols = symptoms in vocabulary
    rows = len(df)
    feature_index = {sym: i for i, sym in enumerate(vocabulary)}
    X = np.zeros((rows, len(vocabulary)), dtype=np.int8)

    for col in symptom_cols:
        for row_idx, raw in enumerate(df[col].values):
            sym = _normalize_symptom(raw)
            if sym and sym in feature_index:
                X[row_idx, feature_index[sym]] = 1

    le = LabelEncoder()
    y = le.fit_transform(df['Disease'].values)

    return X, y, vocabulary, le, df['Disease'].unique()


# ─── Model 1: Symptom Checker (Logistic Regression) ──────────────────────────

def train_symptom_checker(X, y, le, feature_columns):
    banner('Model 1 — Symptom Checker (Logistic Regression)')
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    model = LogisticRegression(max_iter=2000, multi_class='ovr', C=1.0, random_state=42)
    model.fit(X_tr, y_tr)

    preds = model.predict(X_te)
    acc = accuracy_score(y_te, preds)

    print(f'\nAccuracy: {acc * 100:.2f}%')
    print('\nClassification report (top of report):')
    report = classification_report(y_te, preds, target_names=le.classes_, zero_division=0)
    print('\n'.join(report.splitlines()[:15]) + '\n... (truncated)')

    joblib.dump(model, os.path.join(OUT_DIR, 'symptom_checker_lr.pkl'))
    joblib.dump(feature_columns, os.path.join(OUT_DIR, 'symptom_list.pkl'))
    joblib.dump(le, os.path.join(OUT_DIR, 'disease_labels.pkl'))
    print(f'\nSaved -> symptom_checker_lr.pkl  (features: {len(feature_columns)}, classes: {len(le.classes_)})')
    print('Saved -> symptom_list.pkl')
    print('Saved -> disease_labels.pkl')

    return acc


# ─── Model 2: Clinical Diagnosis (Random Forest) ─────────────────────────────

def train_clinical_diagnosis(X, y, le):
    banner('Model 2 — Clinical Diagnosis (Random Forest)')
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    model = RandomForestClassifier(
        n_estimators=200, max_depth=10, random_state=42, n_jobs=-1,
    )
    model.fit(X_tr, y_tr)

    preds = model.predict(X_te)
    acc = accuracy_score(y_te, preds)

    print(f'\nAccuracy: {acc * 100:.2f}%')

    joblib.dump(model, os.path.join(OUT_DIR, 'clinical_diagnosis_rf.pkl'))
    print(f'\nSaved -> clinical_diagnosis_rf.pkl  (features: {X.shape[1]}, classes: {len(le.classes_)})')

    return acc


# ─── Model 3: Risk Predictor (Random Forest) ─────────────────────────────────

def build_risk_dataset():
    """Combine diabetes.csv + heart_disease.csv into a unified risk dataset.

    Common feature schema (5 numeric features):
        age, bmi, blood_pressure_systolic, glucose_level, cholesterol

    Target risk_level:
        0 = low      (no risk factors)
        1 = moderate (1 risk factor)
        2 = high     (>= 2 risk factors)
    """
    diabetes = pd.read_csv(os.path.join(DATA_DIR, 'diabetes.csv'))
    heart = pd.read_csv(os.path.join(DATA_DIR, 'heart_disease.csv'))
    diabetes.columns = [c.strip() for c in diabetes.columns]
    heart.columns = [c.strip() for c in heart.columns]

    # Diabetes rows
    d_rows = pd.DataFrame({
        'age': diabetes['Age'].astype(float),
        'bmi': diabetes['BMI'].replace(0, np.nan).fillna(diabetes['BMI'].median()).astype(float),
        'blood_pressure_systolic': diabetes['BloodPressure'].replace(0, np.nan).fillna(diabetes['BloodPressure'].median()).astype(float),
        'glucose_level': diabetes['Glucose'].replace(0, np.nan).fillna(diabetes['Glucose'].median()).astype(float),
        'cholesterol': 200.0,  # diabetes dataset doesn't carry cholesterol; use population median
        'has_diabetes': diabetes['Outcome'].astype(int),
        'has_heart_disease': 0,
    })

    # Heart rows
    heart_target_col = 'target' if 'target' in heart.columns else 'output'
    h_rows = pd.DataFrame({
        'age': heart['age'].astype(float),
        'bmi': 26.0,  # heart dataset doesn't carry BMI; use population median
        'blood_pressure_systolic': heart['trestbps'].astype(float),
        'glucose_level': 100.0,  # heart dataset doesn't carry glucose; use population median
        'cholesterol': heart['chol'].astype(float),
        'has_diabetes': 0,
        'has_heart_disease': heart[heart_target_col].astype(int),
    })

    df = pd.concat([d_rows, h_rows], ignore_index=True)

    # Count risk factors per row
    rf = (
        (df['has_diabetes'] == 1).astype(int)
        + (df['has_heart_disease'] == 1).astype(int)
        + (df['blood_pressure_systolic'] > 130).astype(int)
        + (df['glucose_level'] > 110).astype(int)
        + (df['cholesterol'] > 220).astype(int)
        + (df['bmi'] > 28).astype(int)
        + (df['age'] > 50).astype(int)
    )

    risk_level = np.where(rf == 0, 0, np.where(rf == 1, 1, 2))

    feature_cols = ['age', 'bmi', 'blood_pressure_systolic', 'glucose_level', 'cholesterol']
    X = df[feature_cols].values.astype(float)
    y = risk_level.astype(int)

    return X, y, feature_cols


def train_risk_predictor():
    banner('Model 3 — Risk Predictor (Random Forest)')
    X, y, feature_cols = build_risk_dataset()
    print(f'\nCombined risk dataset: {X.shape[0]} rows, {X.shape[1]} features')
    print(f'Class distribution: low={int((y==0).sum())}, moderate={int((y==1).sum())}, high={int((y==2).sum())}')

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    model = RandomForestClassifier(n_estimators=200, random_state=42, n_jobs=-1)
    model.fit(X_tr, y_tr)

    preds = model.predict(X_te)
    acc = accuracy_score(y_te, preds)
    print(f'\nAccuracy: {acc * 100:.2f}%')
    print('\nClassification report:')
    print(classification_report(y_te, preds, target_names=['low', 'moderate', 'high'], zero_division=0))

    joblib.dump(model, os.path.join(OUT_DIR, 'risk_predictor_rf.pkl'))
    joblib.dump(feature_cols, os.path.join(OUT_DIR, 'risk_features.pkl'))
    print('\nSaved -> risk_predictor_rf.pkl')
    print('Saved -> risk_features.pkl')

    return acc


# ─── Smoke test: hit the production ml_utils against fresh models ───────────

def smoke_test():
    banner('Smoke Test — Loading saved .pkl files via apps.ai_engine.ml_utils')

    # Make backend importable so we can call ml_utils end-to-end
    backend_dir = os.path.abspath(os.path.join(HERE, '..', 'backend'))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'federcare.settings')
    import django
    try:
        django.setup()
    except Exception:
        pass

    from apps.ai_engine import ml_utils

    print('\n[A] predict_symptoms(["fever", "cough", "fatigue"])')
    r = ml_utils.predict_symptoms(['fever', 'cough', 'fatigue'])
    print(f'    model_used={r["model_used"]}  severity={r["severity"]}')
    print(f'    top diseases: {r["predicted_diseases"][:3]}')

    print('\n[B] clinical_diagnosis(["fever", "cough", "weight_loss"], age=70)')
    r = ml_utils.clinical_diagnosis(['fever', 'cough', 'weight_loss'], {'age': 70})
    print(f'    model_used={r["model_used"]}')
    print(f'    top diagnoses: {r["top_diagnoses"]}')
    print(f'    recommended_tests: {r["recommended_tests"][:5]}')

    print('\n[C] predict_health_risk(45y, bmi 28, bp 135, glucose 110, chol 220, smoker)')
    r = ml_utils.predict_health_risk({
        'age': 45, 'bmi': 28, 'blood_pressure_systolic': 135,
        'glucose_level': 110, 'cholesterol': 220,
        'smoking': True, 'exercise': False,
    })
    print(f'    model_used={r["model_used"]}  overall={r["overall_level"]}')
    print(f'    diabetes={r["diabetes_risk"]}%  heart={r["heart_risk"]}%  htn={r["hypertension_risk"]}%')


# ─── Entrypoint ──────────────────────────────────────────────────────────────

def main():
    banner('FederCare — Training All ML Models from Real Kaggle Datasets')

    # Shared symptom feature matrix (used by Models 1 & 2)
    print('\n[setup] Loading and vectorizing symptom_disease.csv ...')
    X_sym, y_sym, feature_cols, le, raw_classes = load_symptom_disease()
    print(f'  Built feature matrix: {X_sym.shape[0]} samples x {X_sym.shape[1]} symptoms')
    print(f'  Diseases (classes): {len(le.classes_)}')

    accs = {}
    accs['symptom_checker'] = train_symptom_checker(X_sym, y_sym, le, feature_cols)
    accs['clinical_diagnosis'] = train_clinical_diagnosis(X_sym, y_sym, le)
    accs['risk_predictor'] = train_risk_predictor()

    smoke_test()

    banner('Training Summary')
    for name, acc in accs.items():
        print(f'  {name:25s} accuracy = {acc * 100:.2f}%')
    print('\n[OK] All models trained and saved to ml_models/.')


if __name__ == '__main__':
    main()
