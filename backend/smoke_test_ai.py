"""Quick smoke test for the trained AI engine. Run via:
    cd backend && python smoke_test_ai.py
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'federcare.settings')
django.setup()

from apps.ai_engine import ml_utils
ml_utils._CACHE.clear()

print('--- Test A: predict_symptoms (vocabulary-aligned) ---')
r = ml_utils.predict_symptoms(['high_fever', 'cough', 'fatigue'])
print(f'  model_used={r["model_used"]}  severity={r["severity"]}')
for d in r['predicted_diseases']:
    print(f'    {d["disease"]:40s} {d["probability"]:.1f}%')

print('\n--- Test B: clinical_diagnosis with risk flags ---')
r = ml_utils.clinical_diagnosis(
    ['high_fever', 'cough', 'weight_loss', 'breathlessness', 'phlegm'],
    {'age': 70}
)
print(f'  model_used={r["model_used"]}')
for d in r['top_diagnoses']:
    print(f'    {d["disease"]:40s} {d["confidence"]:.1f}%')
print(f'  recommended_tests: {r["recommended_tests"]}')
print(f'  risk_flags: {r["risk_flags"]}')

print('\n--- Test C: predict_health_risk (high-risk profile) ---')
r = ml_utils.predict_health_risk({
    'age': 45, 'bmi': 28, 'blood_pressure_systolic': 135,
    'glucose_level': 110, 'cholesterol': 220,
    'smoking': True, 'exercise': False,
})
print(f'  model_used={r["model_used"]}  overall={r["overall_level"]}')
print(f'  diabetes={r["diabetes_risk"]}%  heart={r["heart_risk"]}%  htn={r["hypertension_risk"]}%')

print('\n--- Test D: predict_health_risk (low-risk profile) ---')
r = ml_utils.predict_health_risk({
    'age': 28, 'bmi': 22, 'blood_pressure_systolic': 110,
    'glucose_level': 85, 'cholesterol': 170,
    'smoking': False, 'exercise': True,
})
print(f'  model_used={r["model_used"]}  overall={r["overall_level"]}')
print(f'  diabetes={r["diabetes_risk"]}%  heart={r["heart_risk"]}%  htn={r["hypertension_risk"]}%')

print('\n--- Test E: known_symptoms (trained vocabulary) ---')
syms = ml_utils.known_symptoms()
print(f'  total: {len(syms)}')
print(f'  first 10: {syms[:10]}')

print('\n--- Test F: input not in vocab (still hits ML model with 0-vector) ---')
r = ml_utils.predict_symptoms(['fever'])
print(f'  model_used={r["model_used"]}  severity={r["severity"]}')
print(f'  top: {r["predicted_diseases"][0] if r["predicted_diseases"] else None}')

print('\n[OK] all smoke tests completed')
