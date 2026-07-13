import io
import re
from decimal import Decimal, InvalidOperation
from xml.sax.saxutils import escape

from django.http import HttpResponse
from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def decimal_value(value):
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal('0')


def money(value):
    return f'Rs. {decimal_value(value):,.2f}'


def billable_payment_status(status):
    return status in ('paid', 'refunded')


def format_datetime(value):
    if not value:
        return '-'
    if hasattr(value, 'strftime'):
        return timezone.localtime(value).strftime('%d %b %Y, %I:%M %p')
    return str(value)


def format_date(value):
    if not value:
        return '-'
    if hasattr(value, 'strftime'):
        return value.strftime('%d %b %Y')
    return str(value)


def format_time(value):
    if not value:
        return '-'
    if hasattr(value, 'strftime'):
        return value.strftime('%I:%M %p')
    return str(value)


def clean_filename(value):
    safe = re.sub(r'[^A-Za-z0-9_-]+', '_', str(value or 'federcare_bill')).strip('_')
    return safe or 'federcare_bill'


def paragraph(text, style):
    return Paragraph(escape(str(text if text is not None else '')), style)


def bill_pdf_response(
    *,
    title,
    bill_no,
    billed_to,
    provider,
    rows,
    total_amount,
    payment_status,
    meta_rows=None,
    notes=None,
):
    """Build a compact FederCare bill PDF and return it as an attachment."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.6 * cm,
        leftMargin=1.6 * cm,
        topMargin=1.4 * cm,
        bottomMargin=1.4 * cm,
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='BillTitle',
        parent=styles['Title'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#101010'),
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name='Muted',
        parent=styles['Normal'],
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#666666'),
    ))
    styles.add(ParagraphStyle(
        name='Small',
        parent=styles['Normal'],
        fontSize=9,
        leading=11,
    ))

    elements = [
        Paragraph('FederCare', styles['BillTitle']),
        Paragraph(escape(title), styles['Heading2']),
        Paragraph(f'Bill No: {escape(str(bill_no))}', styles['Muted']),
        Paragraph(f'Generated: {format_datetime(timezone.now())}', styles['Muted']),
        Spacer(1, 0.35 * cm),
    ]

    party_data = [
        [
            paragraph('Billed To', styles['Small']),
            paragraph('Provider', styles['Small']),
        ],
        [
            paragraph(billed_to.get('name', '-'), styles['Normal']),
            paragraph(provider.get('name', '-'), styles['Normal']),
        ],
        [
            paragraph(billed_to.get('address', ''), styles['Muted']),
            paragraph(provider.get('address', ''), styles['Muted']),
        ],
        [
            paragraph(billed_to.get('contact', ''), styles['Muted']),
            paragraph(provider.get('contact', ''), styles['Muted']),
        ],
    ]
    party_table = Table(party_data, colWidths=[8.7 * cm, 8.7 * cm])
    party_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#FFF7ED')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#F97316')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#E5E5E5')),
        ('INNERGRID', (0, 0), (-1, -1), 0.25, colors.HexColor('#E5E5E5')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    elements.extend([party_table, Spacer(1, 0.35 * cm)])

    if meta_rows:
        meta_data = [[paragraph('Details', styles['Small']), paragraph('', styles['Small'])]]
        for label, value in meta_rows:
            if value not in (None, ''):
                meta_data.append([paragraph(label, styles['Muted']), paragraph(value, styles['Small'])])
        if len(meta_data) > 1:
            meta_table = Table(meta_data, colWidths=[5.2 * cm, 12.2 * cm])
            meta_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F8FAFC')),
                ('SPAN', (0, 0), (-1, 0)),
                ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#E5E5E5')),
                ('INNERGRID', (0, 1), (-1, -1), 0.25, colors.HexColor('#E5E5E5')),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 8),
                ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ]))
            elements.extend([meta_table, Spacer(1, 0.35 * cm)])

    item_data = [[
        paragraph('Description', styles['Small']),
        paragraph('Qty', styles['Small']),
        paragraph('Unit Price', styles['Small']),
        paragraph('Amount', styles['Small']),
    ]]
    for row in rows:
        item_data.append([
            paragraph(row.get('description', '-'), styles['Small']),
            paragraph(row.get('qty', '1'), styles['Small']),
            paragraph(money(row.get('unit_price', 0)), styles['Small']),
            paragraph(money(row.get('amount', 0)), styles['Small']),
        ])
    item_data.extend([
        ['', '', paragraph('Payment Status', styles['Small']), paragraph(str(payment_status).capitalize(), styles['Small'])],
        ['', '', paragraph('Total', styles['Small']), paragraph(money(total_amount), styles['Small'])],
    ])

    item_table = Table(item_data, colWidths=[8.2 * cm, 2.1 * cm, 3.6 * cm, 3.5 * cm])
    item_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#101010')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#E5E5E5')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -3), [colors.white, colors.HexColor('#FFF7ED')]),
        ('BACKGROUND', (2, -2), (-1, -1), colors.HexColor('#F8FAFC')),
        ('FONTNAME', (2, -1), (-1, -1), 'Helvetica-Bold'),
        ('ALIGN', (1, 1), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.extend([item_table, Spacer(1, 0.45 * cm)])

    if notes:
        elements.append(Paragraph(escape(notes), styles['Muted']))
        elements.append(Spacer(1, 0.25 * cm))

    elements.append(Paragraph('This is a computer-generated bill from FederCare.', styles['Muted']))

    doc.build(elements)
    buffer.seek(0)
    response = HttpResponse(buffer.getvalue(), content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{clean_filename(bill_no)}.pdf"'
    return response
