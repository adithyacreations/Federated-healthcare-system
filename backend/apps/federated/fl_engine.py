"""Federated Learning engine: model lifecycle, weight extraction, FedAvg aggregation, and
real local-training on real dataset subsets per hospital."""
import io
import os
import pickle
import logging
import warnings

import numpy as np
import pandas as pd
import joblib
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, log_loss
from sklearn.preprocessing import LabelEncoder
from sklearn.exceptions import ConvergenceWarning

# Early FL rounds intentionally train with a low iteration budget, so the model
# is deliberately under-converged at first and genuinely improves each round.
# That produces expected ConvergenceWarnings — silence them to keep demo output clean.
warnings.filterwarnings('ignore', category=ConvergenceWarning)

logger = logging.getLogger(__name__)

ML_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ml_models'))
DATASET_DIR = os.path.join(ML_DIR, 'datasets')
os.makedirs(ML_DIR, exist_ok=True)

# Rows per class held back from local training and used only as the fixed
# held-out test set for measuring the aggregated global model.
HELDOUT_PER_CLASS = 20


# ─── Dataset helpers ──────────────────────────────────────────────────────────

def _normalize_symptom(s):
    if pd.isna(s):
        return None
    s = str(s).strip().lower()
    s = '_'.join(part for part in s.replace('_', ' ').split() if part)
    return s or None


def _build_symptom_matrix(df, vocabulary):
    """Build a binary (rows × vocabulary) feature matrix from symptom columns."""
    symptom_cols = [c for c in df.columns if c.lower().startswith('symptom_')]
    feature_index = {sym: i for i, sym in enumerate(vocabulary)}
    X = np.zeros((len(df), len(vocabulary)), dtype=np.float32)
    for col in symptom_cols:
        for row_idx, raw in enumerate(df[col].values):
            sym = _normalize_symptom(raw)
            if sym and sym in feature_index:
                X[row_idx, feature_index[sym]] = 1.0
    return X


def _load_symptom_dataset():
    """Load symptom_disease.csv and return (X, y, vocabulary, label_encoder)."""
    df = pd.read_csv(os.path.join(DATASET_DIR, 'symptom_disease.csv'))
    df.columns = [c.strip() for c in df.columns]
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].astype(str).str.strip()
    df['Disease'] = df['Disease'].str.strip()

    symptom_cols = [c for c in df.columns if c.lower().startswith('symptom_')]

    # Build vocabulary: union of symptom_severity.csv + observed symptom values
    severity_path = os.path.join(DATASET_DIR, 'symptom_severity.csv')
    severity_df = pd.read_csv(severity_path)
    severity_df.columns = [c.strip() for c in severity_df.columns]
    severity_symptoms = {_normalize_symptom(s) for s in severity_df['Symptom']}

    observed = set()
    for col in symptom_cols:
        observed.update(_normalize_symptom(s) for s in df[col].dropna().unique())

    vocabulary = sorted(s for s in (severity_symptoms | observed) if s and s.lower() != 'nan')

    X = _build_symptom_matrix(df, vocabulary)

    le = LabelEncoder()
    y = le.fit_transform(df['Disease'].values)

    return X, y, vocabulary, le


def _load_risk_dataset():
    """Build combined diabetes+heart risk dataset. Returns (X, y)."""
    diabetes = pd.read_csv(os.path.join(DATASET_DIR, 'diabetes.csv'))
    heart = pd.read_csv(os.path.join(DATASET_DIR, 'heart_disease.csv'))
    diabetes.columns = [c.strip() for c in diabetes.columns]
    heart.columns = [c.strip() for c in heart.columns]

    d_rows = pd.DataFrame({
        'age': diabetes['Age'].astype(float),
        'bmi': diabetes['BMI'].replace(0, np.nan).fillna(diabetes['BMI'].median()).astype(float),
        'blood_pressure_systolic': (
            diabetes['BloodPressure'].replace(0, np.nan)
            .fillna(diabetes['BloodPressure'].median()).astype(float)
        ),
        'glucose_level': (
            diabetes['Glucose'].replace(0, np.nan)
            .fillna(diabetes['Glucose'].median()).astype(float)
        ),
        'cholesterol': 200.0,
        'has_diabetes': diabetes['Outcome'].astype(int),
        'has_heart_disease': 0,
    })

    heart_target_col = 'target' if 'target' in heart.columns else 'output'
    h_rows = pd.DataFrame({
        'age': heart['age'].astype(float),
        'bmi': 26.0,
        'blood_pressure_systolic': heart['trestbps'].astype(float),
        'glucose_level': 100.0,
        'cholesterol': heart['chol'].astype(float),
        'has_diabetes': 0,
        'has_heart_disease': heart[heart_target_col].astype(int),
    })

    df = pd.concat([d_rows, h_rows], ignore_index=True)
    risk_factors = (
        (df['has_diabetes'] == 1).astype(int)
        + (df['has_heart_disease'] == 1).astype(int)
        + (df['blood_pressure_systolic'] > 130).astype(int)
        + (df['glucose_level'] > 110).astype(int)
        + (df['cholesterol'] > 220).astype(int)
        + (df['bmi'] > 28).astype(int)
        + (df['age'] > 50).astype(int)
    )
    risk_level = np.where(risk_factors == 0, 0, np.where(risk_factors == 1, 1, 2))
    feature_cols = ['age', 'bmi', 'blood_pressure_systolic', 'glucose_level', 'cholesterol']
    X = df[feature_cols].values.astype(float)
    y = risk_level.astype(int)
    return X, y


class FederatedLearningEngine:

    # ─── Model lifecycle ──────────────────────────────────────────────────────

    def initialize_global_model(self, model_type='symptom_checker'):
        """Create a base model trained on the full real dataset. Returns (model_bytes, file_path)."""
        X, y = self._full_dataset(model_type)

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        if model_type == 'symptom_checker':
            model = LogisticRegression(max_iter=500, C=1.0, random_state=42)
        else:
            model = RandomForestClassifier(n_estimators=50, max_depth=10, random_state=42)

        model.fit(X_train, y_train)

        initial_accuracy = accuracy_score(y_test, model.predict(X_test)) * 100
        logger.info('Initial model accuracy on test set: %.2f%%', initial_accuracy)

        filename = f'{model_type}_global.pkl'
        path = os.path.join(ML_DIR, filename)
        joblib.dump(model, path)

        buffer = io.BytesIO()
        joblib.dump(model, buffer)
        buffer.seek(0)
        return buffer.getvalue(), path

    def _full_dataset(self, model_type):
        """Return (X, y) for the full real dataset matching model_type."""
        if model_type in ('symptom_checker', 'clinical_diagnosis'):
            X, y, _, _ = _load_symptom_dataset()
        else:
            X, y = _load_risk_dataset()
        return X, y

    # ─── Weight extraction / application ──────────────────────────────────────

    def get_model_weights(self, model):
        """Extract weights from a fitted model as a JSON-serialisable dict."""
        if isinstance(model, LogisticRegression):
            return {
                'kind': 'logistic_regression',
                'coef': model.coef_.tolist(),
                'intercept': model.intercept_.tolist(),
                'classes': model.classes_.tolist(),
                'n_features': model.n_features_in_,
            }
        if isinstance(model, RandomForestClassifier):
            return {
                'kind': 'random_forest',
                'feature_importances': model.feature_importances_.tolist(),
                'n_estimators': model.n_estimators,
                'classes': model.classes_.tolist(),
                'serialized_model': pickle.dumps(model).hex(),
            }
        raise TypeError(f'Unsupported model type: {type(model).__name__}')

    def apply_weights(self, model_bytes, weights_dict):
        """Apply averaged weights back onto a model. Returns updated model bytes."""
        model = self._load_from_bytes(model_bytes)
        kind = weights_dict.get('kind')

        if kind == 'logistic_regression' and isinstance(model, LogisticRegression):
            model.coef_ = np.array(weights_dict['coef'])
            model.intercept_ = np.array(weights_dict['intercept'])
            if 'classes' in weights_dict:
                model.classes_ = np.array(weights_dict['classes'])
        elif kind == 'random_forest':
            if 'serialized_model' in weights_dict:
                model = pickle.loads(bytes.fromhex(weights_dict['serialized_model']))
        else:
            raise TypeError(f'Cannot apply weights of kind={kind} to {type(model).__name__}')

        buffer = io.BytesIO()
        joblib.dump(model, buffer)
        buffer.seek(0)
        return buffer.getvalue()

    # ─── FedAvg ───────────────────────────────────────────────────────────────

    def federated_averaging(self, weights_list, sample_counts):
        """Weighted average (FedAvg) of model weights based on each hospital's sample count."""
        if not weights_list:
            raise ValueError('weights_list is empty')
        if len(weights_list) != len(sample_counts):
            raise ValueError('weights_list and sample_counts length mismatch')

        kind = weights_list[0].get('kind')
        averaged = {'kind': kind}

        if kind == 'logistic_regression':
            averaged_coef = np.average(
                [np.array(w['coef']) for w in weights_list],
                weights=sample_counts,
                axis=0,
            ).tolist()
            averaged_intercept = np.average(
                [np.array(w['intercept']) for w in weights_list],
                weights=sample_counts,
                axis=0,
            ).tolist()
            averaged['coef'] = averaged_coef
            averaged['intercept'] = averaged_intercept
            averaged['classes'] = weights_list[0]['classes']
            if 'n_features' in weights_list[0]:
                averaged['n_features'] = weights_list[0]['n_features']

        elif kind == 'random_forest':
            fi_arrays = [np.array(w['feature_importances']) for w in weights_list]
            avg_fi = np.average(fi_arrays, weights=sample_counts, axis=0).tolist()
            averaged['feature_importances'] = avg_fi
            averaged['classes'] = weights_list[0]['classes']
            # Use the largest hospital's serialised model as the RF base (proxy averaging)
            biggest_idx = int(np.argmax(sample_counts))
            averaged['serialized_model'] = weights_list[biggest_idx]['serialized_model']
        else:
            raise ValueError(f'Unknown weights kind: {kind}')

        return averaged

    # ─── Local training (real hospital data + Kaggle supplement) ─────────────

    def simulate_local_training(self, hospital_id, model_bytes, model_type='symptom_checker',
                                round_number=1):
        """Train a local model on real hospital patients + a Kaggle supplement.

        Incremental learning across rounds:
          * round 1 trains a fresh model with a small iteration budget
            (deliberately under-converged, like a real early FL round);
          * round 2+ warm-starts from the supplied global model and runs a
            few more iterations, so the model genuinely converges further
            each round — accuracy rises and loss falls round-on-round.

        The per-round seed also shifts the Kaggle slice each round.
        """
        import uuid as uuid_mod

        base_seed = abs(hash(str(hospital_id))) % 10000
        # round_number shifts the seed → a different Kaggle slice every round
        hospital_seed = (base_seed + round_number * 137) % 100000
        patient_count = 0
        data_source = 'reference_only'
        X, y = None, None

        if model_type in ('symptom_checker', 'clinical_diagnosis'):
            vocab_path = os.path.join(ML_DIR, 'symptom_list.pkl')
            symptom_vocab = joblib.load(vocab_path)
            vocab_index = {s: i for i, s in enumerate(symptom_vocab)}

            X_full, y_full, _, kaggle_le = _load_symptom_dataset()
            n_classes = len(kaggle_le.classes_)
            valid_classes = set(kaggle_le.classes_)
            valid_classes_lower = {c.strip().lower(): c for c in valid_classes}

            # Per-class training pool = every row of that class EXCEPT the last
            # HELDOUT_PER_CLASS, which form the fixed held-out global test set.
            class_train_pool = {}
            for cls in range(n_classes):
                rows_c = np.where(y_full == cls)[0]
                pool = rows_c[:-HELDOUT_PER_CLASS] if len(rows_c) > HELDOUT_PER_CLASS else rows_c
                class_train_pool[cls] = pool

            rng = np.random.default_rng(hospital_seed)

            def build_supplement(target_total):
                """Stratified Kaggle pick covering EVERY class. Guarantees all
                hospitals and all rounds produce identically-shaped weight
                matrices — so FedAvg and warm-start never hit a shape mismatch."""
                base = max(1, target_total // n_classes)
                remainder = max(0, target_total - base * n_classes)
                picked = []
                for cls in range(n_classes):
                    k = min(base + (1 if cls < remainder else 0), len(class_train_pool[cls]))
                    chosen = rng.choice(class_train_pool[cls], size=k, replace=False)
                    picked.extend(chosen.tolist())
                picked = np.array(picked)
                return X_full[picked].astype(np.float32), y_full[picked]

            # ── Robust hospital lookup ──────────────────────────────────────
            try:
                if isinstance(hospital_id, str):
                    try:
                        hospital_id_uuid = uuid_mod.UUID(hospital_id)
                    except (ValueError, AttributeError):
                        hospital_id_uuid = hospital_id
                else:
                    hospital_id_uuid = hospital_id
            except Exception:
                hospital_id_uuid = hospital_id

            from apps.hospital.models import HospitalPatient, HospitalRegistration
            hospital_obj = None
            try:
                hospital_obj = HospitalRegistration.objects.get(hospital_id=hospital_id_uuid)
            except HospitalRegistration.DoesNotExist:
                try:
                    hospital_obj = HospitalRegistration.objects.get(hospital_id=str(hospital_id))
                except Exception:
                    hospital_obj = None
            except Exception as exc:
                logger.warning('Hospital lookup failed for %s: %s', hospital_id, exc)
                hospital_obj = None

            qs = []
            if hospital_obj is not None:
                qs = list(HospitalPatient.objects.filter(hospital_id=hospital_obj))
                patient_count = len(qs)
                logger.info('Hospital %s — %d patient records (round %d)',
                            hospital_obj.hospital_name, patient_count, round_number)

            # ── Build the real-patient feature matrix ───────────────────────
            rows, real_labels = [], []
            if patient_count >= 10:
                skipped = 0
                for patient in qs:
                    diagnosis_raw = (patient.diagnosis or '').strip()
                    if not diagnosis_raw:
                        skipped += 1
                        continue
                    if diagnosis_raw in valid_classes:
                        diagnosis = diagnosis_raw
                    elif diagnosis_raw.lower() in valid_classes_lower:
                        diagnosis = valid_classes_lower[diagnosis_raw.lower()]
                    else:
                        skipped += 1
                        continue
                    symptoms = patient.symptoms if isinstance(patient.symptoms, list) else []
                    row = [0] * len(symptom_vocab)
                    for sym_raw in symptoms:
                        sym = '_'.join(
                            p for p in str(sym_raw).strip().lower().replace('_', ' ').split() if p
                        )
                        if sym in vocab_index:
                            row[vocab_index[sym]] = 1
                    rows.append(row)
                    real_labels.append(diagnosis)
                if skipped:
                    logger.warning('%d/%d patients skipped (diagnosis not in Kaggle labels)',
                                   skipped, patient_count)

            # ── Assemble the training set ───────────────────────────────────
            if rows:
                X_real = np.array(rows, dtype=np.float32)
                y_real = kaggle_le.transform(real_labels)
                # Even a real-heavy hospital gets a class-covering supplement so
                # every hospital's model has all 41 classes (FedAvg requires it).
                supp_target = 82 if patient_count >= 50 else 100
                X_kaggle, y_kaggle = build_supplement(supp_target)
                X = np.vstack([X_real, X_kaggle])
                y = np.concatenate([y_real, y_kaggle])
                data_source = f"real({patient_count}) + reference({len(X_kaggle)})"
            else:
                # < 10 real patients — reference dataset only, stratified across all classes
                X, y = build_supplement(30 * n_classes)
                data_source = 'reference_only'
                patient_count = 0

            # Fixed held-out test set (last HELDOUT_PER_CLASS rows of every
            # class, disjoint from every training pool) — used to score this
            # model honestly without removing classes from the training set.
            held_idx = []
            for cls in range(n_classes):
                rows_c = np.where(y_full == cls)[0]
                held_idx.extend(rows_c[-HELDOUT_PER_CLASS:].tolist())
            held_idx = np.array(held_idx)
            eval_X = X_full[held_idx].astype(np.float32)
            eval_y = y_full[held_idx]

        else:
            # risk_predictor: reference dataset only (no HospitalPatient risk data)
            X_full, y_full = _load_risk_dataset()
            rng = np.random.default_rng(hospital_seed)
            n = int(len(X_full) * 0.3)
            idx = rng.choice(len(X_full), size=n, replace=False)
            X = X_full[idx]
            y = y_full[idx]
            data_source = 'reference_only'
            rng_eval = np.random.default_rng(hospital_seed + 1)
            eidx = rng_eval.choice(len(X_full), size=min(400, len(X_full)), replace=False)
            eval_X = X_full[eidx]
            eval_y = y_full[eidx]

        logger.info('Hospital %s round %d: %d samples, data_source=%s',
                    hospital_id, round_number, len(X), data_source)

        # ── Model: round 1 trains fresh; round 2+ warm-starts from global ───
        # Iteration budgets are kept low so the model is genuinely under-
        # converged early and converges further (warm-start) each round.
        fresh_iters = 60
        warm_iters = 70
        model = None
        if round_number > 1 and model_bytes:
            try:
                loaded = self._load_from_bytes(model_bytes)
                if isinstance(loaded, LogisticRegression) and hasattr(loaded, 'coef_'):
                    loaded.warm_start = True
                    loaded.max_iter = warm_iters
                    model = loaded
                elif isinstance(loaded, RandomForestClassifier):
                    model = loaded
            except Exception as exc:
                logger.warning('Could not load global model for warm start: %s', exc)
                model = None

        if model is None:
            if model_type == 'symptom_checker':
                model = LogisticRegression(max_iter=fresh_iters, C=1.0,
                                           random_state=hospital_seed, warm_start=False)
            else:
                model = RandomForestClassifier(n_estimators=50, max_depth=10,
                                               random_state=hospital_seed)

        # Fit on the FULL local set — the stratified supplement guarantees every
        # class is present, so the weight matrix shape is identical across all
        # hospitals and rounds (FedAvg- and warm-start-safe).
        try:
            model.fit(X, y)
        except Exception as exc:
            logger.warning('Local fit failed (%s) — retraining from scratch', exc)
            if model_type == 'symptom_checker':
                model = LogisticRegression(max_iter=fresh_iters, C=1.0, random_state=hospital_seed)
            else:
                model = RandomForestClassifier(n_estimators=50, max_depth=10,
                                               random_state=hospital_seed)
            model.fit(X, y)

        # Local accuracy/loss measured on the fixed held-out test set
        y_pred = model.predict(eval_X)
        local_accuracy = accuracy_score(eval_y, y_pred) * 100
        try:
            y_prob = model.predict_proba(eval_X)
            known_mask = np.isin(eval_y, model.classes_)
            if known_mask.sum() > 0:
                local_loss = log_loss(
                    eval_y[known_mask], y_prob[known_mask], labels=model.classes_
                )
            else:
                local_loss = 0.0
        except Exception:
            local_loss = 0.0

        weights = self.get_model_weights(model)
        weights['data_source'] = data_source
        weights['patient_count'] = patient_count
        weights['train_samples'] = len(X)
        weights['test_samples'] = len(eval_X)
        weights['local_loss'] = round(local_loss, 6)
        weights['round_number'] = round_number

        return weights, len(X), round(local_accuracy, 2)

    def evaluate_global_model(self, model_bytes, model_type='symptom_checker'):
        """Evaluate an aggregated global model on a FIXED held-out Kaggle test set.

        The test set (last HELDOUT_PER_CLASS rows of every class) is identical
        every round and never used for training — so any change in the number
        genuinely reflects the model improving, not test-set noise.

        Returns (accuracy_pct, log_loss) or (None, None) if evaluation fails.
        """
        if model_type not in ('symptom_checker', 'clinical_diagnosis'):
            return None, None
        try:
            X_full, y_full, _, le = _load_symptom_dataset()
            test_idx = []
            for cls in range(len(le.classes_)):
                rows_c = np.where(y_full == cls)[0]
                test_idx.extend(rows_c[-HELDOUT_PER_CLASS:].tolist())
            test_idx = np.array(test_idx)
            X_test = X_full[test_idx].astype(np.float32)
            y_test = y_full[test_idx]

            model = self._load_from_bytes(model_bytes)
            y_pred = model.predict(X_test)
            acc = round(float(accuracy_score(y_test, y_pred)) * 100, 2)
            try:
                y_prob = model.predict_proba(X_test)
                loss = round(float(log_loss(y_test, y_prob, labels=model.classes_)), 6)
            except Exception:
                loss = None
            return acc, loss
        except Exception as exc:
            logger.warning('Global model evaluation failed: %s', exc)
            return None, None

    # ─── Accuracy ─────────────────────────────────────────────────────────────

    def calculate_accuracy(self, model_bytes, X_test, y_test):
        model = self._load_from_bytes(model_bytes)
        try:
            preds = model.predict(X_test)
            return round(float(accuracy_score(y_test, preds)) * 100, 2)
        except Exception as exc:
            logger.warning('Accuracy calc failed: %s', exc)
            return 0.0

    # ─── Helpers ──────────────────────────────────────────────────────────────

    def _load_from_bytes(self, model_bytes):
        return joblib.load(io.BytesIO(model_bytes))

    def _dump_to_bytes(self, model):
        buf = io.BytesIO()
        joblib.dump(model, buf)
        buf.seek(0)
        return buf.getvalue()


def upload_model_to_cloudinary(model_bytes, public_id):
    """Save model .pkl bytes to local media storage. Returns a /media/... URL
    or empty string. (Name kept for backwards-compat with existing call sites;
    Cloudinary was dropped in favour of local storage.)"""
    try:
        from utils import save_bytes_locally
        return save_bytes_locally(model_bytes, f'{public_id}.pkl', subdir='fl_models')
    except Exception as exc:
        logger.warning('Local model save failed: %s', exc)
        return ''
