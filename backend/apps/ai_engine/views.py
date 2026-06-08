import os
from decimal import Decimal
from collections import Counter

import requests
from django.conf import settings
from django.db.models import Count
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser

from apps.auth_app.permissions import IsPatient, IsDoctor, IsSuperAdmin
from apps.patient.models import PatientRegistration, RiskAssessment
from apps.doctor.models import Consultation
from utils import log_audit, send_notification

from .models import TriageSession
from .serializers import (
    TriageSessionSerializer,
    SymptomCheckSerializer,
    ClinicalDiagnosisSerializer,
    RiskPredictionSerializer,
)
from . import ml_utils

MODEL_VERSION = '1.0.0'


def ok(message, data=None, status_code=200):
    return Response(
        {'success': True, 'message': message, 'data': data if data is not None else {}},
        status=status_code,
    )


def err(message, errors=None, status_code=400):
    return Response(
        {'success': False, 'message': message, 'errors': errors or {}},
        status=status_code,
    )


def _get_patient(login):
    try:
        return PatientRegistration.objects.get(login_id=login)
    except PatientRegistration.DoesNotExist:
        return None


# ─── 1. Symptom Checker ─────────────────────────────────────────────────────

class SymptomCheckerView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        ser = SymptomCheckSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', ser.errors)

        patient = _get_patient(request.user)
        if not patient:
            return err('Patient profile not found.', status_code=404)

        symptoms = ser.validated_data['symptoms']
        result = ml_utils.predict_symptoms(symptoms)

        top = result['predicted_diseases'][0] if result['predicted_diseases'] else {'disease': 'Unknown', 'probability': 0.0}

        session = TriageSession.objects.create(
            patient_id=patient,
            symptoms_input=symptoms,
            predicted_diseases=result['predicted_diseases'],
            confidence_score=Decimal(str(top['probability'])),
            severity=result['severity'],
            model_version=MODEL_VERSION,
            emergency_triggered=result['emergency_triggered'],
            recommendation=result['recommendation'],
        )

        log_audit(
            login_id=request.user,
            action='symptom_check',
            module='ai_engine',
            entity_type='TriageSession',
            entity_id=str(session.triage_id),
        )

        response_data = {
            'triage_id': str(session.triage_id),
            'symptoms_input': symptoms,
            'predicted_diseases': result['predicted_diseases'],
            'severity': result['severity'],
            'recommendation': result['recommendation'],
            'emergency_triggered': result['emergency_triggered'],
            'model_used': result['model_used'],
            'model_version': MODEL_VERSION,
        }

        if result['emergency_triggered']:
            response_data['emergency_action'] = (
                'Trigger SOS via /api/emergency/sos/ — your symptoms suggest immediate medical attention.'
            )
            send_notification(
                login_id=request.user,
                title='Emergency Alert',
                message=f"Symptoms suggest {top['disease']} ({result['severity']}). {result['recommendation']}",
                notif_type='emergency',
                related_id=str(session.triage_id),
            )

        return ok('Symptom check complete.', response_data)


# ─── 2. Symptoms List ───────────────────────────────────────────────────────

class GetSymptomsListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        symptoms = ml_utils.known_symptoms()
        return ok('Symptoms list retrieved.', {
            'count': len(symptoms),
            'symptoms': symptoms,
        })


# ─── 3. Clinical Diagnosis (Doctor) ─────────────────────────────────────────

class ClinicalDiagnosisView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request):
        ser = ClinicalDiagnosisSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', ser.errors)

        symptoms = ser.validated_data['symptoms']
        patient_id = ser.validated_data['patient_id']
        consultation_id = ser.validated_data.get('consultation_id')

        try:
            patient = PatientRegistration.objects.get(patient_id=patient_id)
        except PatientRegistration.DoesNotExist:
            return err('Patient not found.', status_code=404)

        from datetime import date
        age = None
        if patient.dob:
            today = date.today()
            age = today.year - patient.dob.year - ((today.month, today.day) < (patient.dob.month, patient.dob.day))

        chronic = list(
            patient.ehr_records.filter(record_type='diagnosis').values_list('title', flat=True)[:5]
        )
        history = {'age': age or 0, 'chronic_conditions': chronic}

        result = ml_utils.clinical_diagnosis(symptoms, patient_history=history)

        consultation = None
        if consultation_id:
            try:
                consultation = Consultation.objects.get(consultation_id=consultation_id)
                consultation.ai_suggestions = {
                    'symptoms': symptoms,
                    'top_diagnoses': result['top_diagnoses'],
                    'recommended_tests': result['recommended_tests'],
                    'risk_flags': result['risk_flags'],
                    'model_used': result['model_used'],
                    'model_version': MODEL_VERSION,
                }
                consultation.save(update_fields=['ai_suggestions'])
            except Consultation.DoesNotExist:
                consultation = None

        log_audit(
            login_id=request.user,
            action='clinical_diagnosis',
            module='ai_engine',
            entity_type='Consultation' if consultation else 'AIDiagnosis',
            entity_id=str(consultation_id) if consultation_id else None,
        )

        return ok('Clinical diagnosis complete.', {
            'patient_id': str(patient.patient_id),
            'patient_name': patient.full_name,
            'symptoms_analyzed': symptoms,
            'top_diagnoses': result['top_diagnoses'],
            'recommended_tests': result['recommended_tests'],
            'risk_flags': result['risk_flags'],
            'saved_to_consultation': bool(consultation),
            'model_used': result['model_used'],
            'model_version': MODEL_VERSION,
            'disclaimer': 'AI suggestions support clinical judgment. Final diagnosis requires physician review.',
        })


# ─── 4. Risk Prediction ─────────────────────────────────────────────────────

class RiskPredictionView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        ser = RiskPredictionSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', ser.errors)

        patient = _get_patient(request.user)
        if not patient:
            return err('Patient profile not found.', status_code=404)

        data = ser.validated_data
        # Use patient's stored BMI if not provided
        if not data.get('bmi') and patient.bmi:
            data['bmi'] = float(patient.bmi)

        result = ml_utils.predict_health_risk(data)

        assessment = RiskAssessment.objects.create(
            patient_id=patient,
            diabetes_risk=Decimal(str(result['diabetes_risk'])),
            heart_risk=Decimal(str(result['heart_risk'])),
            hypertension_risk=Decimal(str(result['hypertension_risk'])),
            risk_level=result['overall_level'],
            recommendations=' | '.join(result['recommendations']),
            alert_sent=result['overall_level'] == 'high',
        )

        log_audit(
            login_id=request.user,
            action='risk_prediction',
            module='ai_engine',
            entity_type='RiskAssessment',
            entity_id=str(assessment.risk_id),
        )

        if result['overall_level'] == 'high':
            send_notification(
                login_id=request.user,
                title='High Health Risk Detected',
                message='Your assessment shows elevated risk. Please book a medical consultation soon.',
                notif_type='alert',
                related_id=str(assessment.risk_id),
            )

        return ok('Risk prediction complete.', {
            'risk_id': str(assessment.risk_id),
            'diabetes_risk': result['diabetes_risk'],
            'heart_risk': result['heart_risk'],
            'hypertension_risk': result['hypertension_risk'],
            'overall_level': result['overall_level'],
            'recommendations': result['recommendations'],
            'model_used': result['model_used'],
            'assessed_at': assessment.assessed_at,
        })


# ─── 5. Patient Risk History ────────────────────────────────────────────────

class PatientRiskHistoryView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        patient = _get_patient(request.user)
        if not patient:
            return err('Patient profile not found.', status_code=404)

        history = list(
            RiskAssessment.objects.filter(patient_id=patient)
            .values(
                'risk_id', 'diabetes_risk', 'heart_risk', 'hypertension_risk',
                'risk_level', 'recommendations', 'alert_sent', 'assessed_at',
            )
        )

        trend = [
            {
                'date': h['assessed_at'].date().isoformat() if h['assessed_at'] else None,
                'diabetes': float(h['diabetes_risk']) if h['diabetes_risk'] else 0.0,
                'heart': float(h['heart_risk']) if h['heart_risk'] else 0.0,
                'hypertension': float(h['hypertension_risk']) if h['hypertension_risk'] else 0.0,
                'level': h['risk_level'],
            }
            for h in history
        ]

        return ok('Risk history retrieved.', {
            'count': len(history),
            'assessments': history,
            'trend': trend,
        })


# ─── 6. Triage History ──────────────────────────────────────────────────────

class TriageHistoryView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        patient = _get_patient(request.user)
        if not patient:
            return err('Patient profile not found.', status_code=404)

        sessions = TriageSession.objects.filter(patient_id=patient).order_by('-created_at')
        return ok('Triage history retrieved.', {
            'count': sessions.count(),
            'sessions': TriageSessionSerializer(sessions, many=True).data,
        })


# ─── 7. AI Stats (Super Admin) ──────────────────────────────────────────────

class AIStatsView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        total_sessions = TriageSession.objects.count()
        emergency_count = TriageSession.objects.filter(emergency_triggered=True).count()

        severity_breakdown = {row['severity'] or 'unknown': row['count']
                              for row in TriageSession.objects.values('severity').annotate(count=Count('triage_id'))}
        for level in ('low', 'moderate', 'high', 'critical'):
            severity_breakdown.setdefault(level, 0)

        # Top 5 predicted diseases across all triage sessions
        disease_counter = Counter()
        for diseases in TriageSession.objects.values_list('predicted_diseases', flat=True):
            if isinstance(diseases, list):
                for d in diseases:
                    if isinstance(d, dict) and 'disease' in d:
                        disease_counter[d['disease']] += 1
        top_predicted = [
            {'disease': name, 'count': count}
            for name, count in disease_counter.most_common(5)
        ]

        total_risk = RiskAssessment.objects.count()
        high_risk_count = RiskAssessment.objects.filter(risk_level='high').count()

        return ok('AI statistics retrieved.', {
            'total_triage_sessions': total_sessions,
            'emergency_triggered_count': emergency_count,
            'severity_breakdown': severity_breakdown,
            'top_predicted_diseases': top_predicted,
            'total_risk_assessments': total_risk,
            'high_risk_patients': high_risk_count,
            'model_version': MODEL_VERSION,
        })


# ════════════════════════════════════════════════════════════════════════════
#  Chest X-Ray AI — MobileNetV2 transfer-learning classifier
# ════════════════════════════════════════════════════════════════════════════

class XRayPredictionView(APIView):
    """AI-assisted chest X-ray analysis (NORMAL vs PNEUMONIA).

    The Keras model is heavy, so it is loaded once and cached on the class.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    _model = None
    _class_indices = None

    @classmethod
    def get_model(cls):
        if cls._model is None:
            import json
            from django.conf import settings

            model_path = os.path.normpath(os.path.join(
                settings.BASE_DIR, '..', 'ml_models', 'chest_xray_model.h5'
            ))
            indices_path = os.path.normpath(os.path.join(
                settings.BASE_DIR, '..', 'ml_models', 'xray_class_indices.json'
            ))

            if os.path.exists(model_path):
                print("Loading X-Ray model...")
                import tensorflow as tf

                # The legacy MobileNetV2 .h5 was saved with Keras 2; under
                # Keras 3 its DepthwiseConv2D config carries a `groups` kwarg
                # that no longer exists. Strip it so the model deserializes.
                class _PatchedDepthwiseConv2D(tf.keras.layers.DepthwiseConv2D):
                    def __init__(self, *args, **kwargs):
                        kwargs.pop('groups', None)
                        super().__init__(*args, **kwargs)

                cls._model = tf.keras.models.load_model(
                    model_path,
                    custom_objects={'DepthwiseConv2D': _PatchedDepthwiseConv2D},
                )
                if os.path.exists(indices_path):
                    with open(indices_path) as f:
                        cls._class_indices = json.load(f)
                else:
                    cls._class_indices = {'NORMAL': 0, 'PNEUMONIA': 1}
                print("X-Ray model loaded!")
            else:
                print(f"Model not found: {model_path}")

        return cls._model, cls._class_indices

    def post(self, request):
        image_file = request.FILES.get('image')
        if not image_file:
            return Response({
                'success': False,
                'message': 'No image provided',
            }, status=400)

        model, class_indices = self.get_model()
        if model is None:
            return Response({
                'success': False,
                'message': 'X-Ray model not available. Please train the model first.',
            }, status=503)

        try:
            import io
            import numpy as np
            import tensorflow as tf
            from PIL import Image

            img = Image.open(io.BytesIO(image_file.read()))
            if img.mode != 'RGB':
                img = img.convert('RGB')
            img = img.resize((224, 224))

            img_array = tf.keras.preprocessing.image.img_to_array(img)
            img_array = np.expand_dims(img_array, axis=0)
            img_array = img_array / 255.0

            prediction = model.predict(img_array, verbose=0)
            confidence = float(prediction[0][0])

            # class_indices maps label -> index; sigmoid output is P(index==1)
            normal_confidence = (1 - confidence) * 100
            pneumonia_confidence = confidence * 100

            if confidence >= 0.5:
                predicted_class = 'PNEUMONIA'
                main_confidence = pneumonia_confidence
                severity = 'HIGH' if confidence > 0.8 else 'MODERATE'
            else:
                predicted_class = 'NORMAL'
                main_confidence = normal_confidence
                severity = 'LOW'

            if predicted_class == 'PNEUMONIA':
                recommendations = [
                    'Consult a pulmonologist immediately',
                    'Consider antibiotic treatment',
                    'Monitor oxygen levels',
                    'Rest and adequate hydration',
                    'Follow-up chest X-ray in 2 weeks',
                ]
                urgency = 'HIGH'
            else:
                recommendations = [
                    'Lungs appear normal',
                    'Continue regular health monitoring',
                    'Maintain good respiratory hygiene',
                    'Annual check-up recommended',
                ]
                urgency = 'LOW'

            return Response({
                'success': True,
                'data': {
                    'predicted_class': predicted_class,
                    'confidence': round(main_confidence, 2),
                    'normal_probability': round(normal_confidence, 2),
                    'pneumonia_probability': round(pneumonia_confidence, 2),
                    'severity': severity,
                    'urgency': urgency,
                    'recommendations': recommendations,
                    'disclaimer': 'This is an AI-assisted prediction. Always consult '
                                  'a qualified radiologist for final diagnosis.',
                },
            })

        except Exception as e:
            print(f"X-Ray prediction error: {e}")
            import traceback
            traceback.print_exc()
            return Response({
                'success': False,
                'message': f'Prediction failed: {str(e)}',
            }, status=500)


# ════════════════════════════════════════════════════════════════════════════
#  Brain Tumor MRI AI — MobileNetV2 4-class classifier (90.6% accuracy)
# ════════════════════════════════════════════════════════════════════════════

class BrainTumorPredictionView(APIView):
    """AI-assisted brain MRI tumor classification.

    Classes: glioma / meningioma / notumor / pituitary. The Keras model is
    heavy, so it is loaded once and cached on the class.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    _model = None
    _class_info = None

    @classmethod
    def get_model(cls):
        if cls._model is None:
            try:
                import json
                from django.conf import settings
                import tensorflow as tf

                model_path = os.path.normpath(os.path.join(
                    settings.BASE_DIR, '..', 'ml_models', 'brain_tumor_v2_model.keras'
                ))
                info_path = os.path.normpath(os.path.join(
                    settings.BASE_DIR, '..', 'ml_models', 'brain_tumor_classes.json'
                ))

                if os.path.exists(model_path):
                    cls._model = tf.keras.models.load_model(model_path)
                    with open(info_path) as f:
                        cls._class_info = json.load(f)
                    print("[AI] Brain tumor model loaded!")
                else:
                    print(f"[AI] Model not found: {model_path}")
            except Exception as e:
                print(f"[AI] Brain tumor load error: {e}")
        return cls._model, cls._class_info

    def post(self, request):
        image_file = request.FILES.get('image')
        if not image_file:
            return Response({
                'success': False,
                'message': 'No image provided!',
            }, status=400)

        try:
            import io
            import numpy as np
            from PIL import Image

            model, class_info = self.get_model()
            if model is None:
                return Response({
                    'success': False,
                    'message': 'Brain tumor model not available!',
                }, status=503)

            img_size = class_info.get('input_size', 224)

            img = Image.open(io.BytesIO(image_file.read())).convert('RGB')
            img = img.resize((img_size, img_size))
            img_array = np.array(img) / 255.0
            img_array = np.expand_dims(img_array, axis=0)

            predictions = model.predict(img_array, verbose=0)
            pred_index = int(np.argmax(predictions[0]))
            confidence = float(np.max(predictions[0])) * 100

            classes = class_info.get('classes', [])
            descriptions = class_info.get('class_descriptions', {})

            predicted_class = classes[pred_index] if pred_index < len(classes) else 'Unknown'
            predicted_label = descriptions.get(
                predicted_class, predicted_class.replace('_', ' ').title()
            )

            all_predictions = []
            for i, cls in enumerate(classes):
                all_predictions.append({
                    'class': cls,
                    'label': descriptions.get(cls, cls.replace('_', ' ').title()),
                    'probability': round(float(predictions[0][i]) * 100, 2),
                })
            all_predictions.sort(key=lambda x: x['probability'], reverse=True)

            is_tumor = predicted_class not in ('no_tumor', 'notumor')

            return Response({
                'success': True,
                'data': {
                    'predicted_class': predicted_class,
                    'predicted_label': predicted_label,
                    'confidence': round(confidence, 2),
                    'is_tumor': is_tumor,
                    'all_predictions': all_predictions,
                    'model_accuracy': class_info.get('accuracy', 0.906),
                    'disclaimer': 'AI prediction only. Always consult a qualified radiologist.',
                },
            })

        except Exception as e:
            print(f"[AI] Brain tumor prediction error: {e}")
            import traceback
            traceback.print_exc()
            return Response({
                'success': False,
                'message': f'Prediction failed: {str(e)}',
            }, status=500)


# ════════════════════════════════════════════════════════════════════════════
#  Chest X-Ray Multi-label AI — MobileNetV2, 14 conditions (AUC 0.80)
# ════════════════════════════════════════════════════════════════════════════

class ChestMultiLabelView(APIView):
    """AI-assisted chest X-ray screening across 14 thoracic conditions.

    Multi-label sigmoid output; a condition is flagged when its probability
    crosses the configured threshold. Model cached once on the class.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    _model = None
    _model_info = None

    @classmethod
    def get_model(cls):
        if cls._model is None:
            try:
                import json
                from django.conf import settings
                import tensorflow as tf

                model_path = os.path.normpath(os.path.join(
                    settings.BASE_DIR, '..', 'ml_models', 'chest_multilabel_model.keras'
                ))
                info_path = os.path.normpath(os.path.join(
                    settings.BASE_DIR, '..', 'ml_models', 'chest_multilabel_info.json'
                ))

                if os.path.exists(model_path):
                    cls._model = tf.keras.models.load_model(model_path)
                    with open(info_path) as f:
                        cls._model_info = json.load(f)
                    print("[AI] Chest multi-label model loaded!")
                else:
                    print(f"[AI] Model not found: {model_path}")
            except Exception as e:
                print(f"[AI] Chest model load error: {e}")
        return cls._model, cls._model_info

    def post(self, request):
        image_file = request.FILES.get('image')
        if not image_file:
            return Response({
                'success': False,
                'message': 'No image provided!',
            }, status=400)

        try:
            import io
            import numpy as np
            from PIL import Image

            model, model_info = self.get_model()
            if model is None:
                return Response({
                    'success': False,
                    'message': 'Chest model not available!',
                }, status=503)

            img_size = model_info.get('input_size', 224)
            threshold = model_info.get('threshold', 0.3)

            img = Image.open(io.BytesIO(image_file.read())).convert('RGB')
            img = img.resize((img_size, img_size))
            img_array = np.array(img) / 255.0
            img_array = np.expand_dims(img_array, axis=0)

            predictions = model.predict(img_array, verbose=0)

            conditions = model_info.get('conditions', [])
            descriptions = model_info.get('condition_descriptions', {})

            all_conditions = []
            detected_conditions = []

            for i, condition in enumerate(conditions):
                # Pneumonia is excluded here — the dedicated pneumonia model
                # (xray-predict) gives a more accurate, focused result.
                if condition.lower() == 'pneumonia':
                    continue
                prob = float(predictions[0][i]) * 100
                is_detected = prob >= (threshold * 100)

                condition_data = {
                    'condition': condition,
                    'description': descriptions.get(condition, condition),
                    'probability': round(prob, 2),
                    'detected': is_detected,
                }
                all_conditions.append(condition_data)
                if is_detected:
                    detected_conditions.append(condition_data)

            all_conditions.sort(key=lambda x: x['probability'], reverse=True)
            detected_conditions.sort(key=lambda x: x['probability'], reverse=True)

            return Response({
                'success': True,
                'data': {
                    'detected_conditions': detected_conditions,
                    'all_conditions': all_conditions,
                    'total_detected': len(detected_conditions),
                    'is_normal': len(detected_conditions) == 0,
                    'threshold_used': threshold,
                    'model_auc': model_info.get('auc', 0.80),
                    'note': 'Pneumonia excluded — use the dedicated pneumonia model for accurate detection.',
                    'disclaimer': 'AI screening only. Always consult a qualified radiologist for diagnosis.',
                },
            })

        except Exception as e:
            print(f"[AI] Chest prediction error: {e}")
            import traceback
            traceback.print_exc()
            return Response({
                'success': False,
                'message': f'Prediction failed: {str(e)}',
            }, status=500)


# ════════════════════════════════════════════════════════════════════════════
#  Skin Disease AI — 4-class lesion classifier (top-1 78.2%, top-3 99.8%)
# ════════════════════════════════════════════════════════════════════════════

class SkinDiseaseView(APIView):
    """AI-assisted skin lesion screening.

    Classes: Benign Lesion / Inflammatory Infection / Melanoma / Skin Cancer.
    Melanoma and Skin Cancer are flagged as urgent. The Keras model is heavy, so
    it is loaded once and cached on the class. Screening aid only — not a
    diagnosis.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    _model = None
    _class_info = None

    @classmethod
    def get_model(cls):
        if cls._model is None:
            try:
                import json
                import tensorflow as tf

                model_path = os.path.normpath(os.path.join(
                    settings.BASE_DIR, '..', 'ml_models', 'skin_disease_v4_model.keras'
                ))
                info_path = os.path.normpath(os.path.join(
                    settings.BASE_DIR, '..', 'ml_models', 'skin_disease_classes.json'
                ))

                if os.path.exists(model_path):
                    cls._model = tf.keras.models.load_model(model_path)
                    with open(info_path) as f:
                        cls._class_info = json.load(f)
                    print("[AI] Skin model loaded!")
                else:
                    print(f"[AI] Skin model not found: {model_path}")
            except Exception as e:
                print(f"[AI] Skin load error: {e}")
        return cls._model, cls._class_info

    def post(self, request):
        image_file = request.FILES.get('image')
        if not image_file:
            return Response({
                'success': False,
                'message': 'No image provided!',
            }, status=400)

        try:
            import io
            import numpy as np
            from PIL import Image

            model, class_info = self.get_model()
            if model is None:
                return Response({
                    'success': False,
                    'message': 'Skin model not available!',
                }, status=503)

            img_size = class_info.get('input_size', 224)

            img = Image.open(io.BytesIO(image_file.read())).convert('RGB')
            img = img.resize((img_size, img_size))
            img_array = np.array(img) / 255.0
            img_array = np.expand_dims(img_array, axis=0)

            predictions = model.predict(img_array, verbose=0)
            pred_index = int(np.argmax(predictions[0]))
            confidence = float(np.max(predictions[0])) * 100

            classes = class_info.get('classes', [])
            descriptions = class_info.get('class_descriptions', {})

            predicted_class = classes[pred_index] if pred_index < len(classes) else 'Unknown'
            predicted_label = descriptions.get(predicted_class, predicted_class)

            is_urgent = (
                'melanoma' in predicted_class.lower()
                or 'cancer' in predicted_class.lower()
            )

            all_predictions = [
                {
                    'class': cls,
                    'label': descriptions.get(cls, cls),
                    'probability': round(float(predictions[0][i]) * 100, 2),
                }
                for i, cls in enumerate(classes)
            ]
            all_predictions.sort(key=lambda x: x['probability'], reverse=True)

            return Response({
                'success': True,
                'data': {
                    'predicted_class': predicted_class,
                    'predicted_label': predicted_label,
                    'confidence': round(confidence, 2),
                    'is_urgent': is_urgent,
                    'all_predictions': all_predictions,
                    'model_accuracy': class_info.get('accuracy', 0.782),
                    'top3_accuracy': class_info.get('top3_accuracy', 0.998),
                    'disclaimer': 'AI screening only. This is NOT a medical diagnosis. '
                                  'Always consult a qualified dermatologist.',
                },
            })

        except Exception as e:
            print(f"[AI] Skin error: {e}")
            import traceback
            traceback.print_exc()
            return Response({
                'success': False,
                'message': f'Analysis failed: {str(e)}',
            }, status=500)


# ════════════════════════════════════════════════════════════════════════════
#  Gemini proxy — keeps the Gemini API key server-side
# ════════════════════════════════════════════════════════════════════════════
#  The browser must NEVER see the Gemini key, so it no longer talks to Google
#  directly. The frontend posts here and we relay the request to the Generative
#  Language API using settings.GEMINI_API_KEY (loaded from backend/.env).

GEMINI_MODEL = 'gemini-2.5-flash'
GEMINI_ENDPOINT = (
    'https://generativelanguage.googleapis.com/v1beta/models/'
    f'{GEMINI_MODEL}:generateContent'
)

# System persona for the in-app chatbot. Lives here (not in the frontend) so the
# prompt and the key both stay on the server.
FEDERCARE_CHAT_CONTEXT = """
You are FederCare Assistant, a helpful medical AI chatbot for FederCare: AI Health Network — an MCA final year project at Mar Thoma Institute of Information Technology, Ayur, Kollam, Kerala.
Developer: Adithya M. Guide: Mrs. Princy Thomas.

ABOUT FEDERCARE:
A complete digital healthcare platform connecting hospitals, doctors, patients, pharmacists, lab techs, ambulance drivers and vendors. It uses Federated Learning to train AI models across hospitals without sharing patient data.

KEY FEATURES:
- Federated Learning with FedAvg algorithm
- AI models: Symptom Checker (Logistic Regression, 41 diseases), Clinical Diagnosis (Random Forest), Pneumonia Detection (MobileNetV2), Chest X-Ray 14 Conditions (MobileNetV2, AUC 0.80), Brain Tumor MRI Detection (MobileNetV2, 90.6% accuracy), AI Health Summary (Gemini API)
- Video Consultation via Jitsi Meet, Emergency SOS with GPS tracking
- EHR Wallet with QR consent system, Medicine ordering with prescription verification
- Lab test booking and reports, Equipment ordering for hospitals
- Epidemic detection and alerts, Razorpay payments, real-time WebSocket notifications

8 USER ROLES: Super Admin, Hospital Admin, Doctor, Patient, Pharmacist, Lab Technician, Ambulance Driver, Equipment Vendor.

INSTRUCTIONS:
- Answer FederCare questions using the info above, and general medical questions.
- Keep responses short and clear.
- If off-topic, politely redirect to medical or FederCare topics.
""".strip()


def _extract_gemini_text(data):
    """Pull the generated text out of a Gemini generateContent response.

    Gemini 2.5 models may include a 'thought' part before the real answer.
    We iterate over every part and concatenate only those that carry actual
    text (i.e. parts where 'thought' is not True).
    """
    try:
        parts = data['candidates'][0]['content']['parts']
        # Concatenate all non-thought text parts
        texts = []
        for part in parts:
            # Skip thinking/reasoning parts — they are internal chain-of-thought
            if part.get('thought'):
                continue
            text = part.get('text', '')
            if text:
                texts.append(text)
        return '\n'.join(texts) if texts else ''
    except (KeyError, IndexError, TypeError):
        return ''


def _call_gemini(payload):
    """Relay a payload to Gemini. Returns (text, error_response).

    On success error_response is None; on failure text is None and
    error_response is a ready-to-return DRF Response.
    """
    api_key = getattr(settings, 'GEMINI_API_KEY', '')
    if not api_key:
        return None, err('AI service not configured.', status_code=503)

    try:
        resp = requests.post(
            GEMINI_ENDPOINT,
            params={'key': api_key},
            json=payload,
            timeout=30,
        )
    except requests.Timeout:
        return None, err('AI service timeout! Please try again.', status_code=504)
    except requests.RequestException as exc:
        print(f'[GEMINI] request error: {exc}')
        return None, err('AI service unavailable!', status_code=502)

    if resp.status_code != 200:
        print(f'[GEMINI] non-200 {resp.status_code}: {resp.text[:300]}')
        return None, err('AI service error!', status_code=502)

    return _extract_gemini_text(resp.json()), None


class GeminiHealthSummaryView(APIView):
    """Generate a comprehensive AI health summary for a patient.

    Accepts an optional frontend prompt but always enriches it with
    server-side patient data (EHR records, prescriptions, allergies,
    lab tests) so the Gemini model has full medical context.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from datetime import date
        from apps.patient.models import EHRRecord, Allergy, LabTestOrder
        from apps.doctor.models import Prescription

        # Resolve the patient — either from the posted patient_id or the
        # logged-in user's own profile.
        patient = None
        patient_id = request.data.get('patient_id')
        if patient_id:
            try:
                patient = PatientRegistration.objects.get(patient_id=patient_id)
            except PatientRegistration.DoesNotExist:
                pass
        if patient is None:
            patient = _get_patient(request.user)
        if patient is None:
            return err('Patient profile not found.', status_code=404)

        # ── Build rich patient context ────────────────────────────────
        def calculate_age(dob):
            today = date.today()
            return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

        patient_data = {
            'name': patient.full_name,
            'age': str(calculate_age(patient.dob)) if patient.dob else 'Unknown',
            'gender': patient.gender or 'Not specified',
            'blood_group': patient.blood_group or 'Not specified',
            'bmi': str(patient.bmi) if patient.bmi else 'Unknown',
            'height': str(patient.height_cm) if patient.height_cm else 'Unknown',
            'weight': str(patient.weight_kg) if patient.weight_kg else 'Unknown',
        }

        # Recent EHR records → diagnoses
        ehr_records = EHRRecord.objects.filter(
            patient_id=patient
        ).order_by('-recorded_at')[:10]
        diagnoses = [
            r.content for r in ehr_records
            if r.record_type == 'diagnosis' and r.content
        ][:5]

        # Recent prescriptions → medicines list
        prescriptions = Prescription.objects.filter(
            patient_id=patient
        ).order_by('-created_at')[:5]
        medicines_list = []
        for p in prescriptions:
            if p.medicines:
                try:
                    meds = p.medicines
                    if isinstance(meds, list):
                        for m in meds:
                            if isinstance(m, dict):
                                medicines_list.append(m.get('name', str(m)))
                            else:
                                medicines_list.append(str(m))
                except Exception:
                    pass

        # Allergies
        allergies = list(
            Allergy.objects.filter(patient_id=patient)
            .values_list('allergen', flat=True)
        )

        # Recent completed lab tests
        lab_orders = LabTestOrder.objects.filter(
            patient_id=patient,
            status='completed',
        ).order_by('-ordered_at')[:5]
        lab_count = lab_orders.count()

        # ── Build comprehensive prompt ────────────────────────────────
        # Use the frontend prompt as a base if provided, but always
        # append the server-side medical data to ensure completeness.
        frontend_prompt = (request.data.get('prompt') or '').strip()

        # Pre-format lists outside the f-string (backslashes aren't
        # allowed inside f-string expressions in Python 3.11).
        diagnoses_text = '\n'.join('- ' + d for d in diagnoses) if diagnoses else 'No diagnoses recorded'
        medicines_text = ', '.join(medicines_list) if medicines_list else 'No medications recorded'
        allergies_text = ', '.join(allergies) if allergies else 'No allergies recorded'
        extra_context = ('ADDITIONAL CONTEXT FROM PATIENT RECORDS:\n' + frontend_prompt) if frontend_prompt else ''

        prompt = f"""You are a medical AI assistant for FederCare Health Network.
Generate a comprehensive, detailed health summary for this patient.

PATIENT INFORMATION:
Name: {patient_data['name']}
Age: {patient_data['age']} years
Gender: {patient_data['gender']}
Blood Group: {patient_data['blood_group']}
Height: {patient_data['height']} cm
Weight: {patient_data['weight']} kg
BMI: {patient_data['bmi']}

MEDICAL HISTORY:
Recent Diagnoses:
{diagnoses_text}

Current Medications:
{medicines_text}

Known Allergies:
{allergies_text}

Recent Lab Tests: {lab_count} completed test(s)

{extra_context}

Please provide a detailed health summary with these sections:
🌟 Overall Health Status
📋 Recent Health Activity
💡 Key Medical Insights
✅ What is Going Well
🎯 Lifestyle Recommendations
👉 Important Alerts or Next Steps

Rules:
- Be warm, friendly and encouraging
- Use simple, patient-friendly language
- Be thorough and detailed — minimum 150 words
- Use the emoji headers shown above for each section
- Do NOT diagnose or prescribe — provide general health guidance
- End with: "⚕️ Always consult your doctor for medical decisions."
"""

        print(f'[GEMINI] Health summary prompt ({len(prompt)} chars) for patient: {patient.full_name}')

        payload = {
            'contents': [{'parts': [{'text': prompt}]}],
            'generationConfig': {
                'temperature': 0.7,
                'maxOutputTokens': 2048,
            },
        }
        text, error_response = _call_gemini(payload)
        if error_response is not None:
            return error_response

        summary_text = text or 'Unable to generate summary. Please try again.'

        print(f'[GEMINI] Summary response length: {len(summary_text)} chars')

        return ok('Summary generated.', {
            'summary': summary_text,
            'patient_name': patient.full_name,
            'model': GEMINI_MODEL,
        })


class GeminiChatView(APIView):
    """Proxy for the FederCare Assistant chatbot (multi-turn).

    Public on purpose — the chatbot lives on the landing page and must answer
    guests too. To stop abuse of the (paid) Gemini key we rate-limit per hour:
    guests by IP (10/hr), logged-in users by login id (50/hr). DRF still runs
    authentication under AllowAny, so request.user is the real user when a valid
    token is sent and AnonymousUser otherwise.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        from django.core.cache import cache

        user = request.user
        if user and user.is_authenticated:
            cache_key = f'gemini_user_{user.pk}'
            max_messages = 50
        else:
            ip = request.META.get(
                'HTTP_X_FORWARDED_FOR',
                request.META.get('REMOTE_ADDR', '0.0.0.0'),
            ).split(',')[0].strip()
            cache_key = f'gemini_guest_{ip}'
            max_messages = 10

        count = cache.get(cache_key, 0)
        if count >= max_messages:
            return err(
                f'Chat limit reached! Maximum {max_messages} messages per hour.',
                status_code=429,
            )
        cache.set(cache_key, count + 1, timeout=3600)

        message = (request.data.get('message') or '').strip()
        if not message:
            return err('Message is required!', status_code=400)

        # history: [{role: 'user'|'model', text: '...'}] — prior turns only.
        history = request.data.get('history') or []
        contents = []
        for turn in history:
            if not isinstance(turn, dict):
                continue
            role = turn.get('role')
            text = (turn.get('text') or '').strip()
            if role in ('user', 'model') and text:
                contents.append({'role': role, 'parts': [{'text': text}]})
        contents.append({'role': 'user', 'parts': [{'text': message}]})

        payload = {
            'system_instruction': {'parts': [{'text': FEDERCARE_CHAT_CONTEXT}]},
            'contents': contents,
            'generationConfig': {'temperature': 0.7, 'maxOutputTokens': 300},
        }
        text, error_response = _call_gemini(payload)
        if error_response is not None:
            return error_response

        return ok('Reply generated.', {
            'reply': text or 'Sorry, I could not respond right now.',
            'model': GEMINI_MODEL,
        })
