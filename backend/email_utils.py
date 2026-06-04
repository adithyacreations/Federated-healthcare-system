from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone

_BRAND = '#1A3C6E'
_ACCENT = '#2E75B6'
_DANGER = '#EF4444'
_SUCCESS = '#06D6A0'


def _base_layout(header_color, header_text, body_html):
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8FAFF;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFF;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:{header_color};padding:28px 36px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:1px;">
              &#x2665; FederCare
            </h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">{header_text}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px;">
            {body_html}
          </td>
        </tr>
        <tr>
          <td style="background:#F8FAFF;padding:20px 36px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
              FederCare &mdash; AI Health Network &bull; Powered by FedAvg Federated Learning<br>
              This is an automated message. Please do not reply.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def _send(to_email, subject, html_content):
    try:
        send_mail(
            subject=subject,
            message='',
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[to_email],
            html_message=html_content,
            fail_silently=False,
        )
        print(f"[email_utils] Email sent to {to_email}")
    except Exception as e:
        print(f"[email_utils] Failed to send email to {to_email}: {e}")


def send_email(to_email, subject, html_content):
    """Generic raw-HTML email sender (used by flows that pass their own markup)."""
    _send(to_email, subject, html_content)


def send_welcome_email(to_email, full_name, role):
    role_display = role.replace('_', ' ').title()
    body = f"""
    <h2 style="color:{_BRAND};margin:0 0 12px;">Welcome, {full_name}!</h2>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Your <strong>{role_display}</strong> account has been created on FederCare.
    </p>
    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 28px;">
      FederCare is an AI-powered federated healthcare network connecting patients, doctors,
      pharmacies, and hospitals — all while keeping your data private and secure.
    </p>
    <a href="http://localhost:3000/login"
       style="display:inline-block;background:{_BRAND};color:#ffffff;text-decoration:none;
              padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
      Login to FederCare
    </a>
    """
    html = _base_layout(_BRAND, "Welcome to FederCare!", body)
    _send(to_email, "Welcome to FederCare!", html)


def send_approval_email(to_email, full_name, entity_type, status):
    entity_display = entity_type.replace('_', ' ').title()
    if status == 'approved':
        header_color = _SUCCESS
        header_text = "Account Approved"
        body = f"""
        <h2 style="color:#065f46;margin:0 0 12px;">Congratulations, {full_name}!</h2>
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">
          Your <strong>{entity_display}</strong> account on FederCare has been
          <strong style="color:{_SUCCESS};">approved</strong> by the Super Admin.
        </p>
        <p style="color:#6b7280;font-size:14px;margin:0 0 28px;">
          You can now log in and access all features available to your role.
        </p>
        <a href="http://localhost:3000/login"
           style="display:inline-block;background:{_BRAND};color:#ffffff;text-decoration:none;
                  padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
          Login to FederCare
        </a>
        """
    else:
        header_color = _DANGER
        header_text = "Account Not Approved"
        body = f"""
        <h2 style="color:#991b1b;margin:0 0 12px;">Hi {full_name},</h2>
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">
          Your <strong>{entity_display}</strong> account application has been reviewed and
          <strong style="color:{_DANGER};">not approved</strong> at this time.
        </p>
        <p style="color:#6b7280;font-size:14px;margin:0 0 28px;">
          If you believe this is an error or would like more information, please contact our
          support team at <a href="mailto:support@federcare.com" style="color:{_ACCENT};">
          support@federcare.com</a>.
        </p>
        """

    html = _base_layout(header_color, f"FederCare Account {status.title()}", body)
    _send(to_email, f"FederCare Account {status.title()}", html)


def send_password_change_email(to_email, full_name):
    now = timezone.now().strftime('%d %b %Y at %I:%M %p')
    body = f"""
    <h2 style="color:#F97316;margin:0 0 12px;">&#x1F510; Password Changed</h2>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Hi <strong>{full_name}</strong>, your FederCare account password was changed successfully on
      <strong>{now}</strong>.
    </p>
    <div style="background:#FFF7ED;border-left:4px solid #F97316;padding:15px;border-radius:8px;margin:0 0 24px;">
      <p style="margin:0;color:#374151;font-size:14px;">
        &#x26A0; If you did not make this change, please contact admin immediately at
        <a href="mailto:federcaresupport@gmail.com" style="color:#F97316;">federcaresupport@gmail.com</a>.
      </p>
    </div>
    """
    html = _base_layout('#F97316', "Security Alert", body)
    _send(to_email, "FederCare: Password Changed Successfully", html)


def send_emergency_alert_email(to_email, hospital_name, patient_name, severity, eta):
    severity_color = _DANGER if severity in ('critical', 'high') else '#F59E0B'
    body = f"""
    <h2 style="color:#7f1d1d;margin:0 0 16px;">Incoming Emergency Patient</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr style="background:#fef2f2;">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fca5a5;">Patient</td>
        <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:#1f2937;border-bottom:1px solid #fca5a5;">{patient_name}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fca5a5;">Severity</td>
        <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:{severity_color};border-bottom:1px solid #fca5a5;">{severity.upper()}</td>
      </tr>
      <tr style="background:#fef2f2;">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;">ETA</td>
        <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:#1f2937;">{eta} minutes</td>
      </tr>
    </table>
    <p style="color:#374151;font-size:15px;font-weight:bold;background:#fef2f2;padding:14px 16px;border-radius:8px;border-left:4px solid {_DANGER};margin:0;">
      Please prepare the emergency team immediately.
    </p>
    """
    html = _base_layout(_DANGER, f"&#x1F6A8; Emergency Alert &mdash; {hospital_name}", body)
    _send(to_email, f"🚨 Emergency Alert — Incoming Patient", html)


def send_epidemic_alert_email(to_email, hospital_name, disease_name, alert_level, region, message):
    alert_colors = {
        'low': '#06D6A0', 'moderate': '#F59E0B',
        'high': '#EF4444', 'critical': '#7C3AED',
    }
    color = alert_colors.get(alert_level, '#EF4444')
    body = f"""
    <h2 style="color:{color};margin:0 0 16px;">{disease_name} Outbreak Detected</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Dear <strong>{hospital_name}</strong>, an epidemic alert has been issued. Please review
      the details below and prepare for an increased patient load.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr style="background:#f8faff;">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Disease</td>
        <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:#1f2937;border-bottom:1px solid #e5e7eb;">{disease_name}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Region</td>
        <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:#1f2937;border-bottom:1px solid #e5e7eb;">{region}</td>
      </tr>
      <tr style="background:#f8faff;">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;">Alert Level</td>
        <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:{color};">{alert_level.upper()}</td>
      </tr>
    </table>
    <p style="color:#374151;font-size:15px;background:#fff3cd;padding:14px 16px;border-radius:8px;border-left:4px solid {color};margin:0;">
      {message}
    </p>
    """
    html = _base_layout(color, f"&#x1F6A8; Epidemic Alert &mdash; {disease_name}", body)
    _send(to_email, f"🚨 Epidemic Alert: {disease_name} — FederCare", html)


def send_appointment_confirmation(to_email, patient_name, doctor_name, doctor_specialization,
                                  appointment_date, appointment_time, jitsi_room_id):
    jitsi_url = f"https://meet.jit.si/{jitsi_room_id}"
    body = f"""
    <h2 style="color:{_BRAND};margin:0 0 12px;">Appointment Confirmed!</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Hi <strong>{patient_name}</strong>, your consultation has been booked successfully.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#f8faff;border-radius:8px;overflow:hidden;margin-bottom:28px;">
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Doctor</td>
        <td style="padding:12px 16px;font-size:14px;font-weight:bold;color:{_BRAND};border-bottom:1px solid #e5e7eb;">Dr. {doctor_name}</td>
      </tr>
      <tr style="background:#eef2ff;">
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Specialization</td>
        <td style="padding:12px 16px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">{doctor_specialization}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Date</td>
        <td style="padding:12px 16px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">{appointment_date}</td>
      </tr>
      <tr style="background:#eef2ff;">
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;">Time</td>
        <td style="padding:12px 16px;font-size:14px;color:#374151;">{appointment_time}</td>
      </tr>
    </table>
    <a href="{jitsi_url}"
       style="display:inline-block;background:{_ACCENT};color:#ffffff;text-decoration:none;
              padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;margin-bottom:20px;">
      Join Video Call
    </a>
    <p style="color:#6b7280;font-size:13px;margin:16px 0 0;line-height:1.6;">
      Join the video call a few minutes before your scheduled time. Ensure your camera and
      microphone are working. Use a quiet, well-lit environment for the best experience.
    </p>
    """
    html = _base_layout(_BRAND, "Your consultation is confirmed", body)
    _send(to_email, "Appointment Confirmed — FederCare", html)


def send_lab_report_email(to_email, patient_name, tests_done, abnormal_flags, report_url):
    tests_html = ''.join(
        f'<li style="padding:4px 0;color:#374151;">{t}</li>'
        for t in (tests_done or [])
    )

    abnormal_html = ''
    if abnormal_flags:
        rows = ''.join(
            f"""<tr>
              <td style="padding:8px 12px;border-bottom:1px solid #fca5a5;color:#374151;">{f.get('test','')}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #fca5a5;color:{_DANGER};font-weight:bold;">{f.get('value','')} {f.get('unit','')}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #fca5a5;color:{_DANGER};">{f.get('status','')}</td>
            </tr>"""
            for f in abnormal_flags
        )
        abnormal_html = f"""
        <p style="color:#991b1b;font-weight:bold;margin:24px 0 8px;">&#x26A0; Abnormal Values</p>
        <table style="width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#fee2e2;">
            <th style="padding:8px 12px;text-align:left;color:#7f1d1d;font-size:13px;">Test</th>
            <th style="padding:8px 12px;text-align:left;color:#7f1d1d;font-size:13px;">Value</th>
            <th style="padding:8px 12px;text-align:left;color:#7f1d1d;font-size:13px;">Status</th>
          </tr>
          {rows}
        </table>
        <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">
          Please consult your doctor regarding the abnormal values highlighted above.
        </p>
        """

    download_btn = ''
    if report_url:
        download_btn = f"""
        <a href="{report_url}"
           style="display:inline-block;background:{_BRAND};color:#ffffff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-size:14px;font-weight:bold;margin-right:12px;">
          Download Report
        </a>
        """

    body = f"""
    <h2 style="color:{_BRAND};margin:0 0 12px;">Your Lab Report is Ready</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Hi <strong>{patient_name}</strong>, your lab test results are now available.
    </p>
    <p style="color:#6b7280;font-size:13px;font-weight:bold;margin:0 0 8px;">Tests Completed:</p>
    <ul style="margin:0 0 20px;padding-left:20px;">{tests_html}</ul>
    {abnormal_html}
    <div style="margin-bottom:12px;">
      {download_btn}
      <a href="http://localhost:3000/patient/consultations"
         style="display:inline-block;background:{_ACCENT};color:#ffffff;text-decoration:none;
                padding:12px 24px;border-radius:8px;font-size:14px;font-weight:bold;">
        Consult Doctor
      </a>
    </div>
    """
    html = _base_layout(_BRAND, "Lab results available", body)
    _send(to_email, "Your Lab Report is Ready — FederCare", html)


def send_dispatch_email(to_email, hospital_name, product_name, quantity, vendor_name,
                        otp, estimated_days, otp_expiry_str, tracking_info=''):
    tracking_row = f"""
    <tr>
      <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Tracking</td>
      <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">{tracking_info}</td>
    </tr>""" if tracking_info else ''

    body = f"""
    <h2 style="color:{_ACCENT};margin:0 0 16px;">&#x1F69A; Your Order Has Been Dispatched!</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Dear <strong>{hospital_name}</strong>,<br>
      Your equipment order has been dispatched by <strong>{vendor_name}</strong>.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#f8faff;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Product</td>
        <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:{_BRAND};border-bottom:1px solid #e5e7eb;">{product_name}</td>
      </tr>
      <tr style="background:#eef2ff;">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Quantity</td>
        <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">{quantity}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Vendor</td>
        <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">{vendor_name}</td>
      </tr>
      <tr style="background:#eef2ff;">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Est. Delivery</td>
        <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;">{estimated_days} days</td>
      </tr>
      {tracking_row}
    </table>
    <table style="width:100%;background:{_BRAND};border-radius:12px;margin-bottom:24px;" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:28px;text-align:center;">
          <p style="color:#00D4FF;margin:0 0 8px;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Delivery OTP</p>
          <p style="color:#ffffff;font-size:52px;font-weight:bold;letter-spacing:14px;margin:0 0 8px;font-family:monospace;">{otp}</p>
          <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:0;">Valid until: {otp_expiry_str}</p>
        </td>
      </tr>
    </table>
    <div style="background:#fffbeb;border-left:4px solid #F59E0B;padding:14px 16px;border-radius:4px;">
      <p style="margin:0;color:#92400e;font-size:14px;">
        <strong>&#x26A0; Important:</strong> Keep this OTP safe. Share it with the delivery
        person when they arrive. Enter it on FederCare to confirm receipt.
      </p>
    </div>
    """
    html = _base_layout(_ACCENT, "Order Dispatched — FederCare", body)
    _send(to_email, "Your Order Has Been Dispatched — FederCare", html)


def send_otp_resend_email(to_email, hospital_name, product_name, otp, otp_expiry_str):
    body = f"""
    <h2 style="color:#F59E0B;margin:0 0 16px;">&#x1F504; New Delivery OTP Generated</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Dear <strong>{hospital_name}</strong>,<br>
      A new delivery OTP has been generated for your order: <strong>{product_name}</strong>
    </p>
    <table style="width:100%;background:{_BRAND};border-radius:12px;margin-bottom:24px;" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:28px;text-align:center;">
          <p style="color:#00D4FF;margin:0 0 8px;font-size:13px;letter-spacing:2px;text-transform:uppercase;">New Delivery OTP</p>
          <p style="color:#ffffff;font-size:52px;font-weight:bold;letter-spacing:14px;margin:0 0 8px;font-family:monospace;">{otp}</p>
          <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:0;">Valid until: {otp_expiry_str}</p>
        </td>
      </tr>
    </table>
    <p style="color:#6b7280;font-size:14px;margin:0;">
      Your previous OTP has been invalidated. Use only this new OTP for delivery confirmation.
    </p>
    """
    html = _base_layout('#F59E0B', "New Delivery OTP — FederCare", body)
    _send(to_email, "New Delivery OTP — FederCare", html)


def send_delivery_confirmed_email(to_email, hospital_name, product_name, quantity, vendor_name):
    body = f"""
    <h2 style="color:{_SUCCESS};margin:0 0 16px;">&#x2705; Order Delivered Successfully!</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Dear <strong>{hospital_name}</strong>,<br>
      Your equipment order has been delivered and confirmed!
    </p>
    <table style="width:100%;border-collapse:collapse;background:#f0fdf4;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #bbf7d0;">Product</td>
        <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:{_BRAND};border-bottom:1px solid #bbf7d0;">{product_name}</td>
      </tr>
      <tr style="background:#dcfce7;">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #bbf7d0;">Quantity</td>
        <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #bbf7d0;">{quantity}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #bbf7d0;">Vendor</td>
        <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #bbf7d0;">{vendor_name}</td>
      </tr>
      <tr style="background:#dcfce7;">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;">Status</td>
        <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:{_SUCCESS};">&#x2705; Delivered</td>
      </tr>
    </table>
    <p style="color:#6b7280;font-size:14px;margin:0;">
      The items have been automatically added to your hospital inventory.
    </p>
    """
    html = _base_layout(_SUCCESS, "Order Delivered — FederCare", body)
    _send(to_email, "Order Delivered Successfully — FederCare", html)


def send_fl_reminder_email(to_email, hospital_name, round_number, deadline, completed, invited):
    body = f"""
    <h2 style="color:#F59E0B;margin:0 0 16px;">&#x23F0; FL Round Reminder</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 16px;">
      Dear <strong>{hospital_name}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Federated Learning <strong>Round {round_number}</strong> is waiting for your
      local model weights!
    </p>
    <table style="width:100%;background:#fffbeb;border-radius:8px;border-left:4px solid #F59E0B;padding:4px;margin-bottom:24px;" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:14px 16px;">
          <p style="margin:0;color:#92400e;font-size:14px;"><strong>Deadline:</strong> {deadline}</p>
          <p style="margin:6px 0 0;color:#92400e;font-size:14px;"><strong>Progress:</strong> {completed}/{invited} hospitals submitted</p>
        </td>
      </tr>
    </table>
    <p style="color:#374151;font-size:14px;margin:0 0 24px;">
      Please log in to FederCare and submit your local weights before the deadline to contribute
      to the federated model improvement.
    </p>
    <a href="http://localhost:3000/hospital"
       style="display:inline-block;background:{_BRAND};color:#ffffff;text-decoration:none;
              padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
      Submit Weights Now
    </a>
    """
    html = _base_layout('#F59E0B', f'FL Round {round_number} — Reminder', body)
    _send(to_email, f'FL Round {round_number} Reminder — FederCare', html)


def send_prescription_email(to_email, patient_name, doctor_name, medicines, pdf_url):
    med_rows = ''.join(
        f"""<tr style="{'background:#f8faff;' if i % 2 == 0 else ''}">
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;">{m.get('name','')}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;">{m.get('dosage','')}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;">{m.get('duration','')}</td>
        </tr>"""
        for i, m in enumerate(medicines or [])
    )

    download_btn = ''
    if pdf_url:
        download_btn = f"""
        <a href="{pdf_url}"
           style="display:inline-block;background:{_BRAND};color:#ffffff;text-decoration:none;
                  padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
          Download Prescription
        </a>
        """

    body = f"""
    <h2 style="color:{_BRAND};margin:0 0 12px;">New Prescription</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Hi <strong>{patient_name}</strong>, Dr. <strong>{doctor_name}</strong> has issued you
      a prescription.
    </p>
    <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;margin-bottom:28px;">
      <tr style="background:{_BRAND};">
        <th style="padding:10px 14px;text-align:left;color:#ffffff;font-size:13px;">Medicine</th>
        <th style="padding:10px 14px;text-align:left;color:#ffffff;font-size:13px;">Dosage</th>
        <th style="padding:10px 14px;text-align:left;color:#ffffff;font-size:13px;">Duration</th>
      </tr>
      {med_rows}
    </table>
    {download_btn}
    <p style="color:#6b7280;font-size:13px;margin:20px 0 0;">
      Follow the prescribed dosage and complete the full course of medication.
      Contact your doctor if you experience any adverse effects.
    </p>
    """
    html = _base_layout(_BRAND, f"Prescription from Dr. {doctor_name}", body)
    _send(to_email, f"Prescription from Dr. {doctor_name}", html)


_ORANGE = '#F97316'


def send_complaint_reply_email(to_email, subject_text, status, reply):
    body = f"""
    <h2 style="color:{_ORANGE};margin:0 0 12px;">Response to Your Complaint</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 8px;"><b>Your Complaint:</b> {subject_text}</p>
    <p style="color:#374151;font-size:15px;margin:0 0 16px;"><b>Status:</b> {status.title()}</p>
    <div style="background:#ffffff;border-left:4px solid {_ORANGE};padding:15px;border-radius:8px;margin:0 0 20px;">
      <p style="margin:0 0 6px;color:#111;font-weight:bold;">Response</p>
      <p style="margin:0;color:#374151;line-height:1.6;">{reply or 'Your complaint has been reviewed.'}</p>
    </div>
    <p style="color:#6b7280;font-size:14px;margin:0;">
      Thank you for helping us improve FederCare.
    </p>
    """
    html = _base_layout(_ORANGE, "Complaint Response — FederCare", body)
    _send(to_email, f"FederCare: Response to your complaint — {subject_text}", html)


def send_equipment_order_hospital_email(to_email, hospital_name, product_name, quantity,
                                        total_price, vendor_name, order_id, estimated_days):
    body = f"""
    <h2 style="color:{_ORANGE};margin:0 0 16px;">&#x1F3E5; Equipment Order Confirmed</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Dear <strong>{hospital_name}</strong>, your equipment order has been placed successfully.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#fff7ed;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fed7aa;">Product</td>
          <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:#101010;border-bottom:1px solid #fed7aa;">{product_name}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fed7aa;">Quantity</td>
          <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #fed7aa;">{quantity}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fed7aa;">Total Price</td>
          <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:{_ORANGE};border-bottom:1px solid #fed7aa;">&#8377;{total_price}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fed7aa;">Vendor</td>
          <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #fed7aa;">{vendor_name}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fed7aa;">Order ID</td>
          <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #fed7aa;">{str(order_id)[:8]}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;">Est. Delivery</td>
          <td style="padding:10px 14px;font-size:14px;color:#374151;">{estimated_days} days</td></tr>
    </table>
    <p style="color:#6b7280;font-size:14px;margin:0;">
      You will receive a delivery OTP by email once your order is dispatched.
    </p>
    """
    html = _base_layout(_ORANGE, "Equipment Order Confirmed — FederCare", body)
    _send(to_email, f"FederCare: Equipment Order Confirmed - {product_name}", html)


def send_equipment_order_vendor_email(to_email, hospital_name, product_name, quantity, total_price):
    body = f"""
    <h2 style="color:{_ORANGE};margin:0 0 16px;">&#x1F4E6; New Order Received</h2>
    <table style="width:100%;border-collapse:collapse;background:#fff7ed;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fed7aa;">Hospital</td>
          <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:#101010;border-bottom:1px solid #fed7aa;">{hospital_name}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fed7aa;">Product</td>
          <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #fed7aa;">{product_name}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #fed7aa;">Quantity</td>
          <td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #fed7aa;">{quantity}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;">Total</td>
          <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:{_ORANGE};">&#8377;{total_price}</td></tr>
    </table>
    <p style="color:#6b7280;font-size:14px;margin:0;">Please process this order promptly.</p>
    """
    html = _base_layout(_ORANGE, "New Equipment Order — FederCare", body)
    _send(to_email, "FederCare: New Equipment Order Received", html)


def _medicine_rows(medicines):
    """Build the per-medicine table rows for a medicine-order email.

    Orders carry a `medicines` JSON list (one order may bundle several
    medicines from the same pharmacy), so we render a row per medicine
    instead of assuming a single item.
    """
    rows = ''
    for m in (medicines or []):
        if isinstance(m, dict):
            name = m.get('name') or m.get('medicine_name') or 'Medicine'
            qty = m.get('quantity', m.get('qty', 1))
            price = m.get('price', '')
        else:
            name, qty, price = str(m), 1, ''
        price_txt = f"&#8377;{price}" if price not in ('', None) else ''
        rows += (
            '<tr>'
            '<td style="padding:10px 14px;font-size:14px;color:#101010;border-bottom:1px solid #f0f0f0;">'
            f'{name}</td>'
            '<td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #f0f0f0;text-align:center;">'
            f'{qty} units</td>'
            '<td style="padding:10px 14px;font-size:14px;color:#374151;border-bottom:1px solid #f0f0f0;text-align:right;">'
            f'{price_txt}</td>'
            '</tr>'
        )
    return rows


def _medicine_subject_name(medicines):
    """Human-friendly medicine label for the email subject line."""
    names = []
    for m in (medicines or []):
        if isinstance(m, dict):
            names.append(m.get('name') or m.get('medicine_name') or 'Medicine')
        else:
            names.append(str(m))
    if not names:
        return 'Medicine'
    if len(names) == 1:
        return names[0]
    return f"{names[0]} +{len(names) - 1} more"


def send_medicine_order_email(to_email, patient_name, medicines, pharmacy_name,
                              total_amount, order_id):
    """Order-placed confirmation sent to the patient (orange header, cream body)."""
    med_label = _medicine_subject_name(medicines)
    body = f"""
    <h2 style="color:{_ORANGE};margin:0 0 8px;">&#x1F48A; Medicine Order Confirmed</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">Your order has been placed!</p>
    <p style="color:#333;font-size:16px;margin:0 0 20px;">Hi <strong>{patient_name}</strong>!</p>

    <div style="background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 12px;color:#000;font-size:16px;">&#x1F4CB; Order Details</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 14px;font-size:12px;color:#999;border-bottom:2px solid #f0f0f0;">Medicine</td>
          <td style="padding:8px 14px;font-size:12px;color:#999;border-bottom:2px solid #f0f0f0;text-align:center;">Qty</td>
          <td style="padding:8px 14px;font-size:12px;color:#999;border-bottom:2px solid #f0f0f0;text-align:right;">Price</td>
        </tr>
        {_medicine_rows(medicines)}
      </table>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <tr><td style="padding:10px 14px;font-size:14px;color:#666;">Pharmacy</td>
            <td style="padding:10px 14px;font-size:14px;font-weight:bold;color:#000;text-align:right;">{pharmacy_name or 'FederCare Pharmacy'}</td></tr>
        <tr><td style="padding:10px 14px;font-size:14px;color:#666;border-top:1px solid #f0f0f0;">Total Amount</td>
            <td style="padding:10px 14px;font-size:16px;font-weight:bold;color:{_ORANGE};text-align:right;border-top:1px solid #f0f0f0;">&#8377;{total_amount}</td></tr>
        <tr><td style="padding:10px 14px;font-size:14px;color:#666;">Order ID</td>
            <td style="padding:10px 14px;font-size:12px;color:#999;font-family:monospace;text-align:right;">#{str(order_id)[:8].upper()}</td></tr>
      </table>
    </div>

    <div style="background:#fff7ed;border-left:4px solid {_ORANGE};padding:16px;border-radius:8px;margin-bottom:20px;">
      <p style="margin:0;font-weight:bold;color:{_ORANGE};font-size:14px;">&#x1F4E6; Delivery Information</p>
      <p style="margin:8px 0 0;color:#666;font-size:13px;">
        Your medicine will be delivered to your address. An OTP will be sent for delivery confirmation.
      </p>
    </div>

    <div style="text-align:center;margin:20px 0;">
      <a href="http://localhost:3000/patient/medicine-orders"
         style="background:{_ORANGE};color:white;padding:12px 32px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:14px;">
        Track Your Order &rarr;
      </a>
    </div>
    """
    html = _base_layout(_ORANGE, "Medicine Order Confirmed — FederCare", body)
    _send(to_email, f"FederCare: Medicine Order Confirmed — {med_label}", html)


def send_pharmacist_order_email(to_email, patient_name, medicines, pharmacy_name,
                                total_amount, order_id):
    """New-order alert sent to the pharmacist (black header)."""
    med_label = _medicine_subject_name(medicines)
    body = f"""
    <h2 style="color:#000;margin:0 0 16px;">&#x1F48A; New Medicine Order</h2>
    <p style="color:#333;font-size:16px;margin:0 0 20px;">
      New order received from <strong>{patient_name}</strong>
    </p>

    <div style="background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 14px;font-size:12px;color:#999;border-bottom:2px solid #f0f0f0;">Medicine</td>
          <td style="padding:8px 14px;font-size:12px;color:#999;border-bottom:2px solid #f0f0f0;text-align:center;">Qty</td>
          <td style="padding:8px 14px;font-size:12px;color:#999;border-bottom:2px solid #f0f0f0;text-align:right;">Price</td>
        </tr>
        {_medicine_rows(medicines)}
      </table>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <tr><td style="padding:8px 14px;font-size:14px;color:#666;">Patient</td>
            <td style="padding:8px 14px;font-size:14px;font-weight:bold;color:#000;text-align:right;">{patient_name}</td></tr>
        <tr><td style="padding:8px 14px;font-size:14px;color:#666;border-top:1px solid #f0f0f0;">Pharmacy</td>
            <td style="padding:8px 14px;font-size:14px;color:#000;text-align:right;border-top:1px solid #f0f0f0;">{pharmacy_name or 'FederCare Pharmacy'}</td></tr>
        <tr><td style="padding:8px 14px;font-size:14px;color:#666;border-top:1px solid #f0f0f0;">Amount</td>
            <td style="padding:8px 14px;font-size:16px;font-weight:bold;color:{_ORANGE};text-align:right;border-top:1px solid #f0f0f0;">&#8377;{total_amount}</td></tr>
        <tr><td style="padding:8px 14px;font-size:14px;color:#666;">Order ID</td>
            <td style="padding:8px 14px;font-size:12px;color:#999;font-family:monospace;text-align:right;">#{str(order_id)[:8].upper()}</td></tr>
      </table>
    </div>

    <p style="color:#6b7280;font-size:14px;margin:0;">Please review and process this order promptly.</p>
    """
    html = _base_layout('#000000', "New Medicine Order — FederCare", body)
    _send(to_email, f"FederCare: New Medicine Order — {med_label}", html)


def send_epidemic_resolved_email(to_email, recipient_name, disease_name, region):
    body = f"""
    <h2 style="color:{_SUCCESS};margin:0 0 12px;">&#x2705; Epidemic Resolved</h2>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Dear <strong>{recipient_name}</strong>, the <strong>{disease_name}</strong> epidemic in
      <strong>{region or 'the region'}</strong> has been resolved by the FederCare admin.
      The situation is now under control.
    </p>
    <p style="color:#6b7280;font-size:14px;margin:0;">
      Thank you for your vigilance and cooperation throughout the alert.
    </p>
    """
    html = _base_layout(_SUCCESS, f"Epidemic Resolved — {disease_name}", body)
    _send(to_email, f"✅ FederCare: {disease_name} Epidemic Resolved", html)
