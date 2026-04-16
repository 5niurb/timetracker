const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const { getPayPeriod, formatDateForDB, getPayPeriodByOffset, getPayPeriodLabel } = require('./lib/pay-periods');
const { validateOnboarding, extractLast4SSN, extractLast4Routing, extractLast4Account, CLINICAL_TITLES } = require('./lib/onboarding-validation');
const { encryptValue } = require('./lib/crypto');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required');
  console.error('Please set these in your Render environment variables');
  process.exit(1);
}

// Encryption key — required for onboarding PII storage
if (!process.env.PAYTRACK_ENCRYPTION_KEY) {
  console.error('ERROR: PAYTRACK_ENCRYPTION_KEY environment variable is required');
  console.error('Generate one with: node scripts/generate-encryption-key.mjs');
  console.error('Then set it in Render environment variables and local .env');
  process.exit(1);
}
// Validate key length at startup (fail fast — don't wait for first onboarding submission)
{
  const keyBuf = Buffer.from(process.env.PAYTRACK_ENCRYPTION_KEY, 'base64');
  if (keyBuf.length !== 32) {
    console.error(
      `ERROR: PAYTRACK_ENCRYPTION_KEY must decode to 32 bytes (got ${keyBuf.length}). ` +
        'Regenerate with: node scripts/generate-encryption-key.mjs',
    );
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Service-role client for storage uploads (bypasses RLS on storage bucket)
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : supabase; // fallback to anon if not set (dev only)

// Multer: memory storage — files buffered in memory, then pushed to Supabase Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png']);
    if (allowed.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPG, and PNG files are accepted'));
    }
  },
});

// Keep-alive ping to prevent Render spin down
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
function setupKeepAlive() {
  if (process.env.NODE_ENV === 'production') {
    setInterval(async () => {
      try {
        const response = await fetch(`${SELF_URL}/api/health`);
        console.log(`[Keep-alive] Ping at ${new Date().toISOString()}: ${response.ok ? 'OK' : 'Failed'}`);
      } catch (err) {
        console.log(`[Keep-alive] Ping failed: ${err.message}`);
      }
    }, 14 * 60 * 1000); // Every 14 minutes
    console.log('[Keep-alive] Scheduled ping every 14 minutes');
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database tables
async function initDatabase() {
  console.log('Initializing Supabase database...');

  // Create employees table
  const { error: empError } = await supabaseAdmin.rpc('create_employees_table_if_not_exists');
  if (empError && !empError.message.includes('already exists')) {
    // Table might already exist, that's fine
    console.log('Employees table check:', empError?.message || 'OK');
  }

  // Check if we have any employees
  const { data: employees, error: countError } = await supabaseAdmin
    .from('employees')
    .select('id')
    .limit(1);

  if (!countError && (!employees || employees.length === 0)) {
    // Insert sample employee
    const { error: insertError } = await supabaseAdmin
      .from('employees')
      .insert({
        name: 'Sample Employee',
        pin: '1234',
        hourly_wage: 15.00,
        pay_type: 'hourly'
      });

    if (!insertError) {
      console.log('Created sample employee with PIN: 1234');
    }
  }

  console.log('Database initialization complete');
}

// Pay period helpers imported from ./lib/pay-periods.js

// Simple email sending function (using fetch to external email API)
async function sendInvoiceEmail(employee, periodStart, periodEnd, summary) {
  // Check if Resend API key is configured
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    console.log('[Email] No RESEND_API_KEY configured - email not sent');
    return { sent: false, reason: 'No API key configured' };
  }

  const emailBody = `
    <h2>LeMed Spa - Pay Period Invoice</h2>
    <p><strong>Employee:</strong> ${employee.name}</p>
    <p><strong>Pay Period:</strong> ${periodStart} to ${periodEnd}</p>

    <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
      <tr style="background: #f5f5f5;">
        <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">Description</th>
        <th style="border: 1px solid #ddd; padding: 10px; text-align: right;">Amount</th>
      </tr>
      <tr>
        <td style="border: 1px solid #ddd; padding: 10px;">Hours Worked (${summary.totalHours.toFixed(2)} hrs @ $${employee.hourlyWage}/hr)</td>
        <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">$${summary.totalWages.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #ddd; padding: 10px;">Service Commissions</td>
        <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">$${summary.totalCommissions.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #ddd; padding: 10px;">Sales Commissions</td>
        <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">$${summary.totalProductCommissions.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #ddd; padding: 10px;">Tips</td>
        <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">$${summary.totalTips.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #ddd; padding: 10px; color: #cc0000;">Less: Cash Tips Already Received</td>
        <td style="border: 1px solid #ddd; padding: 10px; text-align: right; color: #cc0000;">-$${summary.totalCashTips.toFixed(2)}</td>
      </tr>
      <tr style="background: #e8f5e9;">
        <td style="border: 1px solid #ddd; padding: 10px;"><strong>TOTAL PAYABLE</strong></td>
        <td style="border: 1px solid #ddd; padding: 10px; text-align: right;"><strong>$${summary.totalPayable.toFixed(2)}</strong></td>
      </tr>
    </table>

    <p style="color: #666; font-size: 12px;">Submitted via LM PayTrack</p>
  `;

  const recipients = ['lea@lemedspa.com', 'ops@lemedspa.com'];
  const cc = employee.email ? [employee.email] : [];

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'LM PayTrack <paytrack@lemedspa.com>',
        to: recipients,
        cc: cc,
        subject: `Pay Period Invoice - ${employee.name} - ${periodStart} to ${periodEnd}`,
        html: emailBody,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      console.log('[Email] Invoice sent successfully:', result.id);
      return { sent: true, id: result.id };
    } else {
      console.error('[Email] Failed to send:', result);
      return { sent: false, reason: result.message || 'API error' };
    }
  } catch (error) {
    console.error('[Email] Error sending invoice:', error.message);
    return { sent: false, reason: error.message };
  }
}

// ============ API ROUTES ============

// Verify employee PIN
app.post('/api/verify-pin', async (req, res) => {
  const { pin } = req.body;

  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, email, hourly_wage, commission_rate, pay_type')
    .eq('pin', pin)
    .single();

  if (error || !employee) {
    res.json({ success: false, message: 'Invalid PIN' });
  } else {
    res.json({ success: true, employee });
  }
});

// Change PIN
app.post('/api/change-pin', async (req, res) => {
  const { employeeId, currentPin, newPin } = req.body;

  // Verify current PIN
  const { data: employee, error: verifyError } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('pin', currentPin)
    .single();

  if (verifyError || !employee) {
    return res.json({ success: false, message: 'Current PIN is incorrect' });
  }

  // Check if new PIN is already used
  const { data: existing } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('pin', newPin)
    .neq('id', employeeId)
    .single();

  if (existing) {
    return res.json({ success: false, message: 'PIN already in use by another employee' });
  }

  const { error: updateError } = await supabaseAdmin
    .from('employees')
    .update({ pin: newPin })
    .eq('id', employeeId);

  if (updateError) {
    res.json({ success: false, message: 'Failed to change PIN' });
  } else {
    res.json({ success: true, message: 'PIN changed successfully' });
  }
});

// Check for conflicting entries
app.post('/api/check-conflict', async (req, res) => {
  const { employeeId, date } = req.body;

  const { data: existing } = await supabaseAdmin
    .from('time_entries')
    .select('id, start_time, end_time, hours')
    .eq('employee_id', employeeId)
    .eq('date', date)
    .single();

  if (existing) {
    res.json({
      hasConflict: true,
      existingEntry: existing
    });
  } else {
    res.json({ hasConflict: false });
  }
});

// Delete a specific time entry (for override)
app.delete('/api/time-entry/:id', async (req, res) => {
  const { id } = req.params;
  const { employeeId } = req.body;

  // Verify ownership
  const { data: entry } = await supabaseAdmin
    .from('time_entries')
    .select('id')
    .eq('id', parseInt(id))
    .eq('employee_id', employeeId)
    .single();

  if (!entry) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  // Delete related records
  await supabaseAdmin.from('product_sales').delete().eq('time_entry_id', parseInt(id));
  await supabaseAdmin.from('client_entries').delete().eq('time_entry_id', parseInt(id));
  await supabaseAdmin.from('time_entries').delete().eq('id', parseInt(id));

  res.json({ success: true });
});

// Submit time entry with client entries and product sales
app.post('/api/time-entry', async (req, res) => {
  const { employeeId, date, startTime, endTime, breakMinutes, hours, description, clients, productSales } = req.body;

  const { data: timeEntry, error } = await supabaseAdmin
    .from('time_entries')
    .insert({
      employee_id: employeeId,
      date: date,
      start_time: startTime || null,
      end_time: endTime || null,
      break_minutes: breakMinutes || 0,
      hours: hours,
      description: description || ''
    })
    .select()
    .single();

  if (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  const timeEntryId = timeEntry.id;

  // Insert client entries if provided
  if (clients && clients.length > 0) {
    const clientData = clients.map(client => ({
      time_entry_id: timeEntryId,
      client_name: client.clientName,
      procedure_name: client.procedure || '',
      notes: client.notes || '',
      amount_earned: client.amountEarned || 0,
      tip_amount: client.tipAmount || 0,
      tip_received_cash: client.tipReceivedCash ? true : false
    }));

    await supabaseAdmin.from('client_entries').insert(clientData);
  }

  // Insert product sales if provided
  if (productSales && productSales.length > 0) {
    const salesData = productSales.map(sale => ({
      time_entry_id: timeEntryId,
      product_name: sale.productName,
      sale_amount: sale.saleAmount || 0,
      commission_amount: sale.commissionAmount || 0,
      notes: sale.notes || ''
    }));

    await supabaseAdmin.from('product_sales').insert(salesData);
  }

  res.json({ success: true, id: timeEntryId });
});

// Get time entries for an employee with client entries
app.get('/api/time-entries/:employeeId', async (req, res) => {
  const { employeeId } = req.params;

  const { data: entries, error } = await supabaseAdmin
    .from('time_entries')
    .select('id, date, start_time, end_time, break_minutes, hours, description, created_at')
    .eq('employee_id', parseInt(employeeId))
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    return res.json([]);
  }

  // Get client entries and product sales for each time entry
  for (const entry of entries) {
    const { data: clients } = await supabaseAdmin
      .from('client_entries')
      .select('id, client_name, procedure_name, notes, amount_earned, tip_amount, tip_received_cash')
      .eq('time_entry_id', entry.id);

    const { data: productSales } = await supabaseAdmin
      .from('product_sales')
      .select('id, product_name, sale_amount, commission_amount, notes')
      .eq('time_entry_id', entry.id);

    entry.clients = clients || [];
    entry.productSales = productSales || [];
  }

  res.json(entries);
});

// Get pay period summary
app.get('/api/pay-period/:employeeId', async (req, res) => {
  const { employeeId } = req.params;
  const { offset } = req.query;

  const periodOffset = parseInt(offset) || 0;
  const period = getPayPeriodByOffset(periodOffset);

  const startDate = formatDateForDB(period.start);
  const endDate = formatDateForDB(period.end);

  // Get employee info
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('hourly_wage, pay_type')
    .eq('id', parseInt(employeeId))
    .single();

  // Get time entries for this period
  const { data: entries } = await supabaseAdmin
    .from('time_entries')
    .select('id, date, hours')
    .eq('employee_id', parseInt(employeeId))
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  let totalHours = 0;
  let totalCommissions = 0;
  let totalTips = 0;
  let totalCashTips = 0;
  let totalProductCommissions = 0;

  for (const entry of (entries || [])) {
    totalHours += entry.hours;

    // Get client entries
    const { data: clients } = await supabaseAdmin
      .from('client_entries')
      .select('amount_earned, tip_amount, tip_received_cash')
      .eq('time_entry_id', entry.id);

    for (const c of (clients || [])) {
      totalCommissions += c.amount_earned || 0;
      totalTips += c.tip_amount || 0;
      if (c.tip_received_cash) {
        totalCashTips += c.tip_amount || 0;
      }
    }

    // Get product sales
    const { data: sales } = await supabaseAdmin
      .from('product_sales')
      .select('commission_amount')
      .eq('time_entry_id', entry.id);

    for (const s of (sales || [])) {
      totalProductCommissions += s.commission_amount || 0;
    }
  }

  const hourlyWage = employee?.hourly_wage || 0;
  const totalWages = totalHours * hourlyWage;

  // Check if invoice already submitted for this period
  const { data: existingInvoice } = await supabaseAdmin
    .from('invoices')
    .select('id, submitted_at')
    .eq('employee_id', parseInt(employeeId))
    .eq('pay_period_start', startDate)
    .eq('pay_period_end', endDate)
    .single();

  res.json({
    periodStart: startDate,
    periodEnd: endDate,
    periodOffset,
    totalHours,
    totalWages,
    totalCommissions,
    totalTips,
    totalCashTips,
    totalProductCommissions,
    totalPayable: totalWages + totalCommissions + totalTips + totalProductCommissions - totalCashTips,
    hourlyWage,
    entries: entries || [],
    invoiceSubmitted: !!existingInvoice,
    invoiceDate: existingInvoice?.submitted_at
  });
});

// Submit invoice
app.post('/api/submit-invoice', async (req, res) => {
  const { employeeId, periodStart, periodEnd, totalHours, totalWages, totalCommissions, totalTips, totalCashTips, totalProductCommissions, totalPayable } = req.body;

  // Check if already submitted
  const { data: existing } = await supabaseAdmin
    .from('invoices')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('pay_period_start', periodStart)
    .eq('pay_period_end', periodEnd)
    .single();

  if (existing) {
    return res.json({ success: false, message: 'Invoice already submitted for this pay period' });
  }

  // Get employee details
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('name, email, hourly_wage')
    .eq('id', employeeId)
    .single();

  // Create invoice record
  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .insert({
      employee_id: employeeId,
      pay_period_start: periodStart,
      pay_period_end: periodEnd,
      total_hours: totalHours,
      total_wages: totalWages,
      total_commissions: totalCommissions,
      total_tips: totalTips,
      total_product_commissions: totalProductCommissions,
      cash_tips_received: totalCashTips,
      total_payable: totalPayable,
      email_sent: false
    })
    .select()
    .single();

  if (error) {
    return res.json({ success: false, message: 'Failed to create invoice' });
  }

  // Try to send email
  const emailResult = await sendInvoiceEmail(
    { name: employee?.name, email: employee?.email, hourlyWage: employee?.hourly_wage || 0 },
    periodStart,
    periodEnd,
    { totalHours, totalWages, totalCommissions, totalProductCommissions, totalTips, totalCashTips, totalPayable }
  );

  // Log invoice details
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    INVOICE SUBMITTED                       ║
╠════════════════════════════════════════════════════════════╣
║  Employee: ${employee?.name}
║  Period: ${periodStart} to ${periodEnd}
║
║  Hours: ${totalHours.toFixed(2)}
║  Wages: $${totalWages.toFixed(2)}
║  Commissions: $${totalCommissions.toFixed(2)}
║  Product Commissions: $${totalProductCommissions.toFixed(2)}
║  Tips: $${totalTips.toFixed(2)}
║  Cash Tips (already paid): $${totalCashTips.toFixed(2)}
║
║  TOTAL PAYABLE: $${totalPayable.toFixed(2)}
║
║  Email: ${emailResult.sent ? 'SENT' : 'NOT SENT - ' + emailResult.reason}
╚════════════════════════════════════════════════════════════╝
  `);

  // Mark email as sent if successful
  if (emailResult.sent) {
    await supabaseAdmin
      .from('invoices')
      .update({ email_sent: true })
      .eq('id', invoice.id);
  }

  res.json({
    success: true,
    message: emailResult.sent ? 'Invoice submitted and email sent!' : 'Invoice submitted (email not configured)',
    invoiceId: invoice.id,
    emailSent: emailResult.sent
  });
});

// Helper to get today's date in LA timezone
function getLATodayString() {
  const now = new Date();
  const laDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return `${laDate.getFullYear()}-${String(laDate.getMonth() + 1).padStart(2, '0')}-${String(laDate.getDate()).padStart(2, '0')}`;
}

// Get invoice details for email preview
app.get('/api/invoice-preview/:employeeId', async (req, res) => {
  const { employeeId } = req.params;
  const { periodStart, periodEnd } = req.query;

  const { data: employee, error: empError } = await supabaseAdmin
    .from('employees')
    .select('id, name, email, hourly_wage, pay_type')
    .eq('id', parseInt(employeeId))
    .single();

  if (empError || !employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  // Get today's date in LA timezone to filter out future entries
  const todayLA = getLATodayString();

  // Use the earlier of periodEnd or today (to exclude future dates)
  const effectiveEndDate = periodEnd <= todayLA ? periodEnd : todayLA;

  // Get all entries for the period with details (only up to today in LA time)
  const { data: entries } = await supabaseAdmin
    .from('time_entries')
    .select('id, date, start_time, end_time, hours')
    .eq('employee_id', parseInt(employeeId))
    .gte('date', periodStart)
    .lte('date', effectiveEndDate)
    .order('date', { ascending: false }); // Descending order (most recent first)

  const detailedEntries = [];
  let totalHours = 0;
  let totalCommissions = 0;
  let totalTips = 0;
  let totalCashTips = 0;
  let totalProductCommissions = 0;

  for (const entry of (entries || [])) {
    const { data: clients } = await supabaseAdmin
      .from('client_entries')
      .select('client_name, procedure_name, amount_earned, tip_amount, tip_received_cash')
      .eq('time_entry_id', entry.id);

    const { data: products } = await supabaseAdmin
      .from('product_sales')
      .select('product_name, sale_amount, commission_amount')
      .eq('time_entry_id', entry.id);

    let dayCommissions = 0;
    let dayTips = 0;
    let dayCashTips = 0;
    let dayProductCommissions = 0;

    for (const c of (clients || [])) {
      dayCommissions += c.amount_earned || 0;
      dayTips += c.tip_amount || 0;
      if (c.tip_received_cash) dayCashTips += c.tip_amount || 0;
    }

    for (const p of (products || [])) {
      dayProductCommissions += p.commission_amount || 0;
    }

    totalHours += entry.hours;
    totalCommissions += dayCommissions;
    totalTips += dayTips;
    totalCashTips += dayCashTips;
    totalProductCommissions += dayProductCommissions;

    detailedEntries.push({
      id: entry.id, // Include entry ID for delete functionality
      date: entry.date,
      startTime: entry.start_time,
      endTime: entry.end_time,
      hours: entry.hours,
      wages: entry.hours * employee.hourly_wage,
      commissions: dayCommissions,
      productCommissions: dayProductCommissions,
      tips: dayTips,
      cashTips: dayCashTips,
      clients: clients || [],
      products: products || []
    });
  }

  const totalWages = totalHours * employee.hourly_wage;

  res.json({
    employee: {
      name: employee.name,
      email: employee.email,
      hourlyWage: employee.hourly_wage
    },
    periodStart,
    periodEnd,
    entries: detailedEntries,
    summary: {
      totalHours,
      totalWages,
      totalCommissions,
      totalProductCommissions,
      totalTips,
      totalCashTips,
      totalPayable: totalWages + totalCommissions + totalTips + totalProductCommissions - totalCashTips
    }
  });
});

// ============ ADMIN ROUTES ============

// Admin password - set via environment variable or use default
// Generate a strong password from 1Password or similar vault for production
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LM$PayTrack#Admin2026!';

// Verify admin password
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  res.json({ success: password === ADMIN_PASSWORD });
});

// Get all employees (includes onboarding status)
app.get('/api/admin/employees', async (req, res) => {
  const { data: employees, error } = await supabaseAdmin
    .from('employees')
    .select(
      'id, name, pin, email, phone, hourly_wage, additional_pay_rate, rate_notes, commission_rate, pay_type, designation, contractor_type, status, created_at, onboarding_token, onboarding_completed_at',
    );

  res.json(employees || []);
});

// Add new employee — auto-generates onboarding_token
app.post('/api/admin/employees', async (req, res) => {
  const {
    name,
    pin,
    email,
    phone,
    hourlyWage,
    additionalPayRate,
    rateNotes,
    commissionRate,
    payType,
    designation,
    contractorType,
    startDate,
  } = req.body;

  // Check if PIN already exists
  const { data: existing } = await supabaseAdmin.from('employees').select('id').eq('pin', pin).single();

  if (existing) {
    return res.status(400).json({ success: false, message: 'PIN already exists' });
  }

  const onboardingToken = randomUUID();

  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .insert({
      name: name,
      pin: pin,
      email: email || null,
      phone: phone?.trim() || null,
      hourly_wage: hourlyWage || 0,
      additional_pay_rate: additionalPayRate ? parseFloat(additionalPayRate) : null,
      rate_notes: rateNotes?.trim() || null,
      commission_rate: commissionRate || 0,
      pay_type: payType || 'hourly',
      designation: designation?.trim() || null,
      contractor_type: contractorType || null,
      start_date: startDate || null,
      onboarding_token: onboardingToken,
    })
    .select()
    .single();

  if (error) {
    res.status(400).json({ success: false, message: error.message });
  } else {
    res.json({ success: true, id: employee.id, onboardingToken });
  }
});

// Update employee
app.put('/api/admin/employees/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name,
    pin,
    email,
    phone,
    hourlyWage,
    additionalPayRate,
    rateNotes,
    commissionRate,
    payType,
    designation,
    contractorType,
    status,
  } = req.body;

  // Check if PIN already exists for another employee
  const { data: existing } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('pin', pin)
    .neq('id', parseInt(id))
    .single();

  if (existing) {
    return res.status(400).json({ success: false, message: 'PIN already exists' });
  }

  const { error } = await supabaseAdmin
    .from('employees')
    .update({
      name: name,
      pin: pin,
      email: email || null,
      phone: phone?.trim() || null,
      hourly_wage: hourlyWage || 0,
      additional_pay_rate: additionalPayRate ? parseFloat(additionalPayRate) : null,
      rate_notes: rateNotes?.trim() || null,
      commission_rate: commissionRate || 0,
      pay_type: payType || 'hourly',
      designation: designation?.trim() || null,
      contractor_type: contractorType || null,
      status: status || 'active',
    })
    .eq('id', parseInt(id));

  if (error) {
    res.status(400).json({ success: false, message: error.message });
  } else {
    res.json({ success: true });
  }
});

// Delete employee
app.delete('/api/admin/employees/:id', async (req, res) => {
  const { id } = req.params;

  // Get time entries for this employee
  const { data: timeEntries } = await supabaseAdmin
    .from('time_entries')
    .select('id')
    .eq('employee_id', parseInt(id));

  // Delete related records
  for (const entry of (timeEntries || [])) {
    await supabaseAdmin.from('product_sales').delete().eq('time_entry_id', entry.id);
    await supabaseAdmin.from('client_entries').delete().eq('time_entry_id', entry.id);
  }

  await supabaseAdmin.from('invoices').delete().eq('employee_id', parseInt(id));
  await supabaseAdmin.from('time_entries').delete().eq('employee_id', parseInt(id));
  await supabaseAdmin.from('employees').delete().eq('id', parseInt(id));

  res.json({ success: true });
});

// Get all time entries (admin view)
app.get('/api/admin/time-entries', async (req, res) => {
  const { startDate, endDate, employeeId } = req.query;

  let query = supabaseAdmin
    .from('time_entries')
    .select(`
      id,
      date,
      start_time,
      end_time,
      break_minutes,
      hours,
      description,
      created_at,
      employee_id,
      employees (
        id,
        name,
        hourly_wage,
        commission_rate,
        pay_type
      )
    `)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (startDate && endDate) {
    query = query.gte('date', startDate).lte('date', endDate);
  }

  if (employeeId) {
    query = query.eq('employee_id', parseInt(employeeId));
  }

  const { data: entries, error } = await query;

  if (error) {
    return res.json([]);
  }

  // Transform and get client entries and product sales for each time entry
  const transformedEntries = [];
  for (const entry of (entries || [])) {
    const { data: clients } = await supabaseAdmin
      .from('client_entries')
      .select('id, client_name, procedure_name, notes, amount_earned, tip_amount, tip_received_cash')
      .eq('time_entry_id', entry.id);

    const { data: productSales } = await supabaseAdmin
      .from('product_sales')
      .select('id, product_name, sale_amount, commission_amount, notes')
      .eq('time_entry_id', entry.id);

    transformedEntries.push({
      id: entry.id,
      date: entry.date,
      start_time: entry.start_time,
      end_time: entry.end_time,
      break_minutes: entry.break_minutes,
      hours: entry.hours,
      description: entry.description,
      created_at: entry.created_at,
      employee_id: entry.employee_id,
      employee_name: entry.employees?.name,
      hourly_wage: entry.employees?.hourly_wage,
      commission_rate: entry.employees?.commission_rate,
      pay_type: entry.employees?.pay_type,
      clients: clients || [],
      productSales: productSales || []
    });
  }

  res.json(transformedEntries);
});

// Delete time entry (admin)
app.delete('/api/admin/time-entries/:id', async (req, res) => {
  const { id } = req.params;

  await supabaseAdmin.from('product_sales').delete().eq('time_entry_id', parseInt(id));
  await supabaseAdmin.from('client_entries').delete().eq('time_entry_id', parseInt(id));
  await supabaseAdmin.from('time_entries').delete().eq('id', parseInt(id));

  res.json({ success: true });
});

// Get all invoices (admin)
app.get('/api/admin/invoices', async (req, res) => {
  const { data: invoices, error } = await supabaseAdmin
    .from('invoices')
    .select(`
      *,
      employees (
        name
      )
    `)
    .order('submitted_at', { ascending: false });

  const transformedInvoices = (invoices || []).map(inv => ({
    ...inv,
    employee_name: inv.employees?.name
  }));

  res.json(transformedInvoices);
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============ ONBOARDING ROUTES ============

// Admin: get onboarding details for an employee (masked — no *_encrypted columns)
app.get('/api/admin/employees/:id/onboarding', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { id } = req.params;

  const { data: record, error } = await supabaseAdmin
    .from('employee_onboarding')
    .select(
      `id, employee_id, first_name, last_name, middle_name, preferred_name,
       mobile_phone, date_of_birth,
       address_street, address_city, address_state, address_zip,
       tin_last4, tin_type, w9_entity_name, w9_tax_classification, w9_collected_at,
       driver_license_number, driver_license_state, driver_license_upload_path,
       professional_licenses,
       insurer_name, insurance_policy_number, insurance_expiration, insurance_upload_path,
       prof_liability_per_occurrence, prof_liability_aggregate,
       bank_name, bank_account_owner_name, bank_account_type,
       bank_routing_last4, bank_account_last4,
       payment_method, zelle_contact,
       time_commitment_bucket, other_commitments,
       attestation_checked, attestation_signature, attestation_date,
       submitted_at`,
    )
    .eq('employee_id', parseInt(id))
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    return res.status(404).json({ success: false, message: 'No onboarding data found' });
  }

  res.json({ success: true, data: record });
});

// Admin: generate a new onboarding token for an existing employee
app.post('/api/admin/employees/:id/onboarding-token', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { id } = req.params;
  const newToken = randomUUID();

  const { error } = await supabaseAdmin
    .from('employees')
    .update({ onboarding_token: newToken, onboarding_completed_at: null })
    .eq('id', parseInt(id));

  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }

  res.json({ success: true, onboardingToken: newToken });
});

// Admin: send onboarding link via SMS or email
app.post('/api/admin/employees/:id/send-link', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { id } = req.params;
  const { type } = req.body; // 'sms' or 'email'

  if (!['sms', 'email'].includes(type)) {
    return res.status(400).json({ success: false, message: 'type must be sms or email' });
  }

  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, email, phone, onboarding_token, onboarding_completed_at')
    .eq('id', parseInt(id))
    .single();

  if (error || !employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  if (!employee.onboarding_token) {
    return res.status(400).json({ success: false, message: 'No onboarding token — generate one first' });
  }

  if (employee.onboarding_completed_at) {
    return res.status(400).json({ success: false, message: 'Onboarding already completed' });
  }

  const firstName = (employee.name || '').split(' ')[0];
  const onboardingUrl = `${req.protocol}://${req.get('host')}/onboarding/${employee.onboarding_token}`;

  if (type === 'sms') {
    if (!employee.phone) {
      return res.status(400).json({ success: false, message: 'No phone number on file' });
    }

    const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
    if (!TWILIO_SID || !TWILIO_TOKEN) {
      return res.status(500).json({ success: false, message: 'Twilio not configured' });
    }

    const smsBody = `Hi ${firstName}, this is LeMed Spa. Please complete your onboarding form at the link below. The form collects your tax, license, insurance, and payment details — it takes about 10 minutes.\n\n${onboardingUrl}\n\nQuestions? Reply to this text or call 818-463-3772.`;

    // Normalize phone to E.164
    let toPhone = employee.phone.replace(/\D/g, '');
    if (toPhone.length === 10) toPhone = '1' + toPhone;
    if (!toPhone.startsWith('+')) toPhone = '+' + toPhone;

    try {
      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
          },
          body: new URLSearchParams({
            From: '+12134442242',
            To: toPhone,
            Body: smsBody,
          }),
        },
      );

      const result = await twilioRes.json();

      if (twilioRes.ok) {
        console.log(`[SendLink] SMS sent to ${toPhone} for employee ${id}, SID: ${result.sid}`);
        return res.json({ success: true, message: `Text sent to ${employee.phone}` });
      } else {
        console.error('[SendLink] Twilio error:', result);
        return res.status(500).json({ success: false, message: result.message || 'SMS failed' });
      }
    } catch (err) {
      console.error('[SendLink] SMS error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to send SMS' });
    }
  }

  if (type === 'email') {
    if (!employee.email) {
      return res.status(400).json({ success: false, message: 'No email on file' });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return res.status(500).json({ success: false, message: 'Resend not configured' });
    }

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #333; line-height: 1.7;">
        <div style="border-bottom: 2px solid #c9a84c; padding-bottom: 16px; margin-bottom: 24px;">
          <h1 style="font-size: 20px; color: #222; margin: 0;">LeMed Spa</h1>
        </div>
        <p>Hi ${firstName} — Welcome to the LeMed Spa family!</p>
        <p>Please visit our onboarding workflow which automatically collects your contact info, insurance coverage, payment preferences, and other info needed to get you properly setup in our systems. It also requires you to upload your government ID and license/insurance info.</p>
        <p>Access it via this link:</p>
        <p style="margin: 20px 0;">
          <a href="${onboardingUrl}" style="color: #c9a84c; font-weight: 600;">LM &ndash; New Team Member Onboarding</a>
        </p>
        <p>Will also use the responses to pre-populate a W9 form and send to you for electronic signature.</p>
        <p>If you have any questions, please let Lea know or just reply here.</p>
        <p>We look forward to working with you!</p>
        <p style="margin-top: 28px; margin-bottom: 4px;"><em>Regards,</em></p>
        <p style="margin: 0;">
          <strong>Accounts</strong> | <strong>Operations</strong><br>
          <a href="mailto:accounts@lemedspa.com" style="color: #c9a84c;">accounts@lemedspa.com</a> | <a href="mailto:ops@lemedspa.com" style="color: #c9a84c;">ops@lemedspa.com</a>
        </p>
      </div>
    `;

    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'LeMed Spa Onboarding <ops@lemedspa.com>',
          to: [employee.email],
          cc: ['lea@lemedspa.com'],
          subject: `LeMed Spa — New Team Member Onboarding`,
          html: emailHtml,
        }),
      });

      const result = await emailRes.json();

      if (emailRes.ok) {
        console.log(`[SendLink] Email sent to ${employee.email} for employee ${id}, ID: ${result.id}`);
        return res.json({ success: true, message: `Email sent to ${employee.email}` });
      } else {
        console.error('[SendLink] Resend error:', result);
        return res.status(500).json({ success: false, message: result.message || 'Email failed' });
      }
    } catch (err) {
      console.error('[SendLink] Email error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to send email' });
    }
  }
});

// Public: prefill data for onboarding form (returns employee job info for pre-population)
app.get('/api/onboarding/:token/prefill', async (req, res) => {
  const { token } = req.params;

  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select(
      'id, name, email, phone, designation, contractor_type, pay_type, hourly_wage, additional_pay_rate, rate_notes, onboarding_completed_at',
    )
    .eq('onboarding_token', token)
    .single();

  if (error || !employee) {
    return res.status(404).json({ success: false, message: 'Invalid onboarding link' });
  }

  if (employee.onboarding_completed_at) {
    return res.status(409).json({ success: false, message: 'Onboarding already completed' });
  }

  // Split name into first/last for pre-fill (best effort)
  const nameParts = (employee.name || '').trim().split(/\s+/);
  const first_name = nameParts[0] || '';
  const last_name = nameParts.slice(1).join(' ') || '';

  res.json({
    success: true,
    prefill: {
      first_name,
      last_name,
      email: employee.email || '',
      phone: employee.phone || '',
      designation: employee.designation || '',
      contractor_type: employee.contractor_type || '',
      pay_type: employee.pay_type || '',
      hourly_wage: employee.hourly_wage || '',
      additional_pay_rate: employee.additional_pay_rate || '',
      rate_notes: employee.rate_notes || '',
    },
  });
});

// Public: upload a file during onboarding (driver license or insurance certificate)
app.post(
  '/api/onboarding/:token/upload',
  upload.single('file'),
  async (req, res) => {
    const { token } = req.params;
    const { fileType } = req.body; // 'driver_license' or 'insurance'

    // Validate token
    const { data: employee, error: empError } = await supabaseAdmin
      .from('employees')
      .select('id, onboarding_completed_at')
      .eq('onboarding_token', token)
      .single();

    if (empError || !employee) {
      return res.status(404).json({ success: false, message: 'Invalid onboarding link' });
    }

    if (employee.onboarding_completed_at) {
      return res.status(409).json({ success: false, message: 'Onboarding already completed' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (!fileType || (!['driver_license', 'insurance'].includes(fileType) && !fileType.startsWith('license_'))) {
      return res.status(400).json({ success: false, message: 'Invalid fileType' });
    }

    const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : req.file.mimetype === 'image/png' ? 'png' : 'jpg';
    const storagePath = `employee-${employee.id}/${fileType}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('onboarding-documents')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('[Upload] Storage error:', uploadError);
      return res.status(500).json({ success: false, message: 'File upload failed. Please try again.' });
    }

    res.json({ success: true, path: storagePath });
  },
);

// Multer error handler (file too large, wrong type)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('Only PDF')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

// Public: serve onboarding page (validates token)
app.get('/onboarding/:token', async (req, res) => {
  const { token } = req.params;

  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, onboarding_completed_at')
    .eq('onboarding_token', token)
    .single();

  if (error || !employee) {
    return res.status(404).send(`
      <!DOCTYPE html><html><head><title>Invalid Link</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#0a0a0a;color:#ccc;}
      h2{color:#c9a84c;}</style></head>
      <body><h2>Invalid Onboarding Link</h2>
      <p>This link is invalid or has expired. Please contact your administrator.</p></body></html>
    `);
  }

  if (employee.onboarding_completed_at) {
    return res.status(200).send(`
      <!DOCTYPE html><html><head><title>Already Complete</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#0a0a0a;color:#ccc;}
      h2{color:#6bff6b;}</style></head>
      <body><h2>Onboarding Complete</h2>
      <p>Your onboarding was already submitted. Thank you!</p></body></html>
    `);
  }

  // Serve the onboarding HTML page
  res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
});

// Public: submit onboarding form
app.post('/api/onboarding/:token', async (req, res) => {
  const { token } = req.params;

  // Verify token
  const { data: employee, error: empError } = await supabaseAdmin
    .from('employees')
    .select('id, name, onboarding_completed_at')
    .eq('onboarding_token', token)
    .single();

  if (empError || !employee) {
    return res.status(404).json({ success: false, message: 'Invalid or expired onboarding link' });
  }

  if (employee.onboarding_completed_at) {
    return res.status(409).json({ success: false, message: 'Onboarding already completed' });
  }

  // Look up employee designation to determine conditional validation
  const { data: empDetail } = await supabaseAdmin
    .from('employees')
    .select('designation')
    .eq('id', employee.id)
    .single();
  const designation = empDetail?.designation || '';
  const requireLicenseInsurance = CLINICAL_TITLES.has(designation);

  // Validate all fields
  const form = req.body;
  const errors = validateOnboarding(form, { requireLicenseInsurance });

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  // Extract masked values
  const tin_last4 = form.tin_raw ? extractLast4SSN(form.tin_raw) : null;
  const bank_routing_last4 = form.bank_routing_raw
    ? extractLast4Routing(form.bank_routing_raw)
    : null;
  const bank_account_last4 = form.bank_account_raw
    ? extractLast4Account(form.bank_account_raw)
    : null;

  // Encrypt sensitive fields with AES-256-GCM before storing
  const [tin_encrypted, bank_routing_encrypted, bank_account_encrypted] = await Promise.all([
    encryptValue(form.tin_raw || null),
    form.payment_method === 'ach' ? encryptValue(form.bank_routing_raw || null) : Promise.resolve(null),
    form.payment_method === 'ach' ? encryptValue(form.bank_account_raw || null) : Promise.resolve(null),
  ]);

  // Parse professional_licenses — may arrive as JSON string from FormData
  let professionalLicenses = form.professional_licenses;
  if (typeof professionalLicenses === 'string') {
    try {
      professionalLicenses = JSON.parse(professionalLicenses);
    } catch {
      professionalLicenses = [];
    }
  }

  const onboardingRecord = {
    employee_id: employee.id,
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    middle_name: form.middle_name?.trim() || null,
    preferred_name: form.preferred_name?.trim() || null,
    mobile_phone: form.mobile_phone?.trim() || null,
    date_of_birth: form.date_of_birth || null,
    address_street: form.address_street?.trim() || null,
    address_city: form.address_city?.trim() || null,
    address_state: form.address_state || null,
    address_zip: form.address_zip?.trim() || null,
    tin_last4,
    tin_type: form.tin_type || null,
    tin_encrypted,
    w9_entity_name: form.w9_entity_name?.trim() || null,
    w9_tax_classification: form.w9_tax_classification || null,
    driver_license_number: form.driver_license_number?.trim() || null,
    driver_license_state: form.driver_license_state || null,
    driver_license_upload_path: form.driver_license_upload_path || null,
    professional_licenses: Array.isArray(professionalLicenses) ? professionalLicenses : [],
    insurer_name: form.insurer_name?.trim() || null,
    insurance_policy_number: form.insurance_policy_number?.trim() || null,
    insurance_expiration: form.insurance_expiration || null,
    insurance_upload_path: form.insurance_upload_path || null,
    prof_liability_per_occurrence: form.prof_liability_per_occurrence
      ? parseFloat(form.prof_liability_per_occurrence)
      : null,
    prof_liability_aggregate: form.prof_liability_aggregate
      ? parseFloat(form.prof_liability_aggregate)
      : null,
    bank_name: form.bank_name?.trim() || null,
    bank_account_owner_name: form.bank_account_owner_name?.trim() || null,
    bank_account_type: form.payment_method === 'ach' ? (form.bank_account_type || null) : null,
    bank_routing_last4: form.payment_method === 'ach' ? bank_routing_last4 : null,
    bank_account_last4: form.payment_method === 'ach' ? bank_account_last4 : null,
    // Encrypted ACH fields — null for Zelle path (no stale plaintext left behind)
    bank_routing_encrypted,
    bank_account_encrypted,
    payment_method: form.payment_method || null,
    zelle_contact: form.zelle_contact?.trim() || null,
    time_commitment_bucket: form.time_commitment_bucket || null,
    other_commitments: form.other_commitments?.trim() || null,
    attestation_checked: true,
    attestation_signature: form.attestation_signature.trim(),
    attestation_date: form.attestation_date,
  };

  // Insert onboarding record
  const { error: insertError } = await supabaseAdmin.from('employee_onboarding').insert(onboardingRecord);

  if (insertError) {
    console.error('[Onboarding] Insert error:', insertError);
    return res.status(500).json({ success: false, message: 'Failed to save onboarding data. Please try again.' });
  }

  // Mark employee as onboarded
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('employees')
    .update({
      ic_agreement_signed: true,
      ic_agreement_signed_at: now,
      onboarding_completed_at: now,
    })
    .eq('id', employee.id);

  console.log(`[Onboarding] Completed for employee ${employee.id} (${employee.name})`);

  res.json({ success: true, message: 'Onboarding submitted successfully' });
});

// ============ TAX FILINGS ROUTES ============

// List tax filings — optionally filtered by year
app.get('/api/admin/tax-filings', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const { year, employee_id } = req.query;

  let query = supabaseAdmin
    .from('tax_filings')
    .select(
      `id, employee_id, tax_year, form_type, filing_status, filed_at,
       recipient_name, tin_last4, tin_type, federal_id_type,
       box_1_nonemployee_comp, box_4_federal_tax_withheld,
       address_city, address_state, address_zip,
       source, notes, created_at, updated_at,
       employees ( name, email )`,
    )
    .order('tax_year', { ascending: false })
    .order('recipient_name', { ascending: true });

  if (year) query = query.eq('tax_year', parseInt(year));
  if (employee_id) query = query.eq('employee_id', parseInt(employee_id));

  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json(data || []);
});

// Get a single tax filing by id
app.get('/api/admin/tax-filings/:id', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const { data, error } = await supabaseAdmin
    .from('tax_filings')
    .select('*')
    .eq('id', parseInt(req.params.id))
    .single();

  if (error) return res.status(404).json({ success: false, message: 'Not found' });
  res.json(data);
});

// Create a tax filing
app.post('/api/admin/tax-filings', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const body = req.body;

  // Encrypt TIN if provided
  let tin_encrypted = null;
  let tin_last4 = body.tin_last4 || null;
  if (body.tin_raw) {
    tin_encrypted = await encryptValue(body.tin_raw);
    tin_last4 = body.tin_raw.replace(/\D/g, '').slice(-4) || null;
  }

  const { data, error } = await supabaseAdmin
    .from('tax_filings')
    .insert({
      employee_id: body.employee_id ? parseInt(body.employee_id) : null,
      tax_year: parseInt(body.tax_year),
      form_type: body.form_type || '1099-NEC',
      filing_status: body.filing_status || 'draft',
      filed_at: body.filed_at || null,
      payer_name: body.payer_name || 'LM Operations Inc',
      payer_ein: body.payer_ein || null,
      payer_state_no: body.payer_state_no || null,
      reference_id: body.reference_id || null,
      recipient_name: body.recipient_name,
      recipient_second_name: body.recipient_second_name || null,
      federal_id_type: body.federal_id_type ? parseInt(body.federal_id_type) : null,
      tin_last4,
      tin_encrypted,
      second_tin_notice: body.second_tin_notice || false,
      account_number: body.account_number || null,
      office_code: body.office_code || null,
      address_street: body.address_street || null,
      address_street2: body.address_street2 || null,
      address_city: body.address_city || null,
      address_state: body.address_state || null,
      address_zip: body.address_zip || null,
      address_province: body.address_province || null,
      address_country_code: body.address_country_code || 'US',
      recipient_email: body.recipient_email || null,
      box_1_nonemployee_comp: parseFloat(body.box_1_nonemployee_comp) || 0,
      box_2_direct_sales: body.box_2_direct_sales || false,
      box_3_golden_parachute: body.box_3_golden_parachute ? parseFloat(body.box_3_golden_parachute) : null,
      box_4_federal_tax_withheld: body.box_4_federal_tax_withheld ? parseFloat(body.box_4_federal_tax_withheld) : null,
      box_5_state_tax_withheld: body.box_5_state_tax_withheld ? parseFloat(body.box_5_state_tax_withheld) : null,
      box_6_state: body.box_6_state || null,
      box_7_state_income: body.box_7_state_income ? parseFloat(body.box_7_state_income) : null,
      box_5b_local_tax_withheld: body.box_5b_local_tax_withheld ? parseFloat(body.box_5b_local_tax_withheld) : null,
      box_6b_locality: body.box_6b_locality || null,
      box_6b_locality_no: body.box_6b_locality_no || null,
      box_7b_local_income: body.box_7b_local_income ? parseFloat(body.box_7b_local_income) : null,
      source: body.source || 'manual',
      notes: body.notes || null,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ success: false, message: error.message });
  res.json({ success: true, data });
});

// Update a tax filing (e.g., change status to 'filed', update compensation amounts)
app.put('/api/admin/tax-filings/:id', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const body = req.body;
  const updates = { updated_at: new Date().toISOString() };

  const allowed = [
    'filing_status', 'filed_at', 'payer_name', 'payer_ein', 'payer_state_no', 'reference_id',
    'recipient_name', 'recipient_second_name', 'federal_id_type', 'second_tin_notice',
    'account_number', 'office_code', 'address_street', 'address_street2', 'address_city',
    'address_state', 'address_zip', 'address_province', 'address_country_code', 'recipient_email',
    'box_1_nonemployee_comp', 'box_2_direct_sales', 'box_3_golden_parachute',
    'box_4_federal_tax_withheld', 'box_5_state_tax_withheld', 'box_6_state', 'box_7_state_income',
    'box_5b_local_tax_withheld', 'box_6b_locality', 'box_6b_locality_no', 'box_7b_local_income',
    'source', 'notes',
  ];

  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  // Handle TIN re-encryption if raw value supplied
  if (body.tin_raw) {
    updates.tin_encrypted = await encryptValue(body.tin_raw);
    updates.tin_last4 = body.tin_raw.replace(/\D/g, '').slice(-4) || null;
  }

  const { data, error } = await supabaseAdmin
    .from('tax_filings')
    .update(updates)
    .eq('id', parseInt(req.params.id))
    .select()
    .single();

  if (error) return res.status(400).json({ success: false, message: error.message });
  res.json({ success: true, data });
});

// Delete a tax filing
app.delete('/api/admin/tax-filings/:id', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const { error } = await supabaseAdmin.from('tax_filings').delete().eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ success: false, message: error.message });
  res.json({ success: true });
});

// Export tax filings for a year as Avalara/Track1099-compatible CSV
// Matches the 1099-NEC CSV template columns used by LeMed
app.get('/api/admin/tax-filings/export/:year', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const year = parseInt(req.params.year);

  const { data, error } = await supabaseAdmin
    .from('tax_filings')
    .select('*')
    .eq('tax_year', year)
    .order('recipient_name', { ascending: true });

  if (error) return res.status(500).json({ success: false, message: error.message });

  const rows = data || [];
  const headers = [
    'Reference ID', "Recipient's Name", "Recipient's Second Name",
    'Federal ID Type', 'Federal ID Number', 'Second TIN Notice', 'Account Number', 'Office Code',
    'Street Address', 'Street Address 2', 'City', 'State', 'ZIP', 'Province', 'Country Code',
    'Email',
    'Box 1 Nonemployee Compensation', 'Box 2 Direct Sales Indicator',
    'Box 3 Other Income', 'Box 4 Federal Income Tax Withheld',
    'Box 5 State Tax Withheld', 'Box 6 State', "Payer's State No", 'Box 7 State Income',
    'Box 5b Local Tax Withheld', 'Box 6b Locality', 'Box 6b Locality No', 'Box 7b Local Income',
  ];

  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const csvLines = [headers.join(',')];
  for (const r of rows) {
    csvLines.push([
      r.reference_id, r.recipient_name, r.recipient_second_name,
      r.federal_id_type, r.tin_last4 ? `***${r.tin_last4}` : '', r.second_tin_notice ? '1' : '', r.account_number, r.office_code,
      r.address_street, r.address_street2, r.address_city, r.address_state, r.address_zip, r.address_province, r.address_country_code || 'US',
      r.recipient_email,
      r.box_1_nonemployee_comp, r.box_2_direct_sales ? '1' : '',
      r.box_3_golden_parachute, r.box_4_federal_tax_withheld,
      r.box_5_state_tax_withheld, r.box_6_state, r.payer_state_no, r.box_7_state_income,
      r.box_5b_local_tax_withheld, r.box_6b_locality, r.box_6b_locality_no, r.box_7b_local_income,
    ].map(escape).join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="1099-NEC-${year}.csv"`);
  res.send(csvLines.join('\r\n'));
});

// ============ EMPLOYEE DOCUMENTS ROUTES ============

// GET /api/admin/employees/:id/documents — list docs with signed download URLs
app.get('/api/admin/employees/:id/documents', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const { data, error } = await supabaseAdmin
    .from('employee_documents')
    .select('id, document_type, file_path, file_name, notes, uploaded_at')
    .eq('employee_id', parseInt(req.params.id))
    .order('uploaded_at', { ascending: false });

  if (error) return res.status(500).json({ success: false, message: error.message });

  // Generate signed URLs (1 hour)
  const docs = await Promise.all(
    (data || []).map(async (doc) => {
      const { data: signed } = await supabaseAdmin.storage
        .from('onboarding-documents')
        .createSignedUrl(doc.file_path, 3600);
      return { ...doc, url: signed?.signedUrl || null };
    }),
  );

  res.json(docs);
});

// POST /api/admin/employees/:id/documents — upload a new doc
app.post(
  '/api/admin/employees/:id/documents',
  upload.single('file'),
  async (req, res) => {
    const { password } = req.headers;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const employeeId = parseInt(req.params.id);
    const { document_type, notes } = req.body;

    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    if (!document_type) return res.status(400).json({ success: false, message: 'document_type required' });

    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
    const storagePath = `employee-${employeeId}/${document_type}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('onboarding-documents')
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (uploadError) return res.status(500).json({ success: false, message: 'File upload failed' });

    const { data, error } = await supabaseAdmin
      .from('employee_documents')
      .insert({
        employee_id: employeeId,
        document_type,
        file_path: storagePath,
        file_name: req.file.originalname,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true, doc: data });
  },
);

// DELETE /api/admin/employee-documents/:docId — remove a doc
app.delete('/api/admin/employee-documents/:docId', async (req, res) => {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Unauthorized' });

  // Fetch path before deleting
  const { data: doc } = await supabaseAdmin
    .from('employee_documents')
    .select('file_path')
    .eq('id', parseInt(req.params.docId))
    .single();

  if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

  // Remove from storage
  await supabaseAdmin.storage.from('onboarding-documents').remove([doc.file_path]);

  // Remove DB row
  const { error } = await supabaseAdmin
    .from('employee_documents')
    .delete()
    .eq('id', parseInt(req.params.docId));

  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true });
});

// Start server
async function start() {
  await initDatabase();
  setupKeepAlive();

  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    LM PAYTRACK                             ║
╠════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                  ║
║                                                            ║
║  Employee App:  http://localhost:${PORT}                      ║
║  Admin Panel:   http://localhost:${PORT}/admin                ║
║                                                            ║
║  Using Supabase PostgreSQL for data persistence            ║
║  Admin Password: Set via ADMIN_PASSWORD env var            ║
╚════════════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);
