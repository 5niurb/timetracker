const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const path = require('path');

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

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  const { error: empError } = await supabase.rpc('create_employees_table_if_not_exists');
  if (empError && !empError.message.includes('already exists')) {
    // Table might already exist, that's fine
    console.log('Employees table check:', empError?.message || 'OK');
  }

  // Check if we have any employees
  const { data: employees, error: countError } = await supabase
    .from('employees')
    .select('id')
    .limit(1);

  if (!countError && (!employees || employees.length === 0)) {
    // Insert sample employee
    const { error: insertError } = await supabase
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

// Pay period helper functions
function getPayPeriod(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  if (day <= 15) {
    // First half: 1st to 15th
    return {
      start: new Date(year, month, 1),
      end: new Date(year, month, 15)
    };
  } else {
    // Second half: 16th to end of month
    const lastDay = new Date(year, month + 1, 0).getDate();
    return {
      start: new Date(year, month, 16),
      end: new Date(year, month, lastDay)
    };
  }
}

function formatDateForDB(date) {
  return date.toISOString().split('T')[0];
}

function getPayPeriodByOffset(offset = 0) {
  const today = new Date();
  let targetDate = new Date(today);

  // Move by pay periods
  for (let i = 0; i < Math.abs(offset); i++) {
    if (offset < 0) {
      // Go back
      const currentPeriod = getPayPeriod(targetDate);
      targetDate = new Date(currentPeriod.start);
      targetDate.setDate(targetDate.getDate() - 1);
    } else {
      // Go forward
      const currentPeriod = getPayPeriod(targetDate);
      targetDate = new Date(currentPeriod.end);
      targetDate.setDate(targetDate.getDate() + 1);
    }
  }

  return getPayPeriod(targetDate);
}

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

  const { data: employee, error } = await supabase
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
  const { data: employee, error: verifyError } = await supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('pin', currentPin)
    .single();

  if (verifyError || !employee) {
    return res.json({ success: false, message: 'Current PIN is incorrect' });
  }

  // Check if new PIN is already used
  const { data: existing } = await supabase
    .from('employees')
    .select('id')
    .eq('pin', newPin)
    .neq('id', employeeId)
    .single();

  if (existing) {
    return res.json({ success: false, message: 'PIN already in use by another employee' });
  }

  const { error: updateError } = await supabase
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

  const { data: existing } = await supabase
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
  const { data: entry } = await supabase
    .from('time_entries')
    .select('id')
    .eq('id', parseInt(id))
    .eq('employee_id', employeeId)
    .single();

  if (!entry) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  // Delete related records
  await supabase.from('product_sales').delete().eq('time_entry_id', parseInt(id));
  await supabase.from('client_entries').delete().eq('time_entry_id', parseInt(id));
  await supabase.from('time_entries').delete().eq('id', parseInt(id));

  res.json({ success: true });
});

// Submit time entry with client entries and product sales
app.post('/api/time-entry', async (req, res) => {
  const { employeeId, date, startTime, endTime, breakMinutes, hours, description, clients, productSales } = req.body;

  const { data: timeEntry, error } = await supabase
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

    await supabase.from('client_entries').insert(clientData);
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

    await supabase.from('product_sales').insert(salesData);
  }

  res.json({ success: true, id: timeEntryId });
});

// Get time entries for an employee with client entries
app.get('/api/time-entries/:employeeId', async (req, res) => {
  const { employeeId } = req.params;

  const { data: entries, error } = await supabase
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
    const { data: clients } = await supabase
      .from('client_entries')
      .select('id, client_name, procedure_name, notes, amount_earned, tip_amount, tip_received_cash')
      .eq('time_entry_id', entry.id);

    const { data: productSales } = await supabase
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
  const { data: employee } = await supabase
    .from('employees')
    .select('hourly_wage, pay_type')
    .eq('id', parseInt(employeeId))
    .single();

  // Get time entries for this period
  const { data: entries } = await supabase
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
    const { data: clients } = await supabase
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
    const { data: sales } = await supabase
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
  const { data: existingInvoice } = await supabase
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
  const { data: existing } = await supabase
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
  const { data: employee } = await supabase
    .from('employees')
    .select('name, email, hourly_wage')
    .eq('id', employeeId)
    .single();

  // Create invoice record
  const { data: invoice, error } = await supabase
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
    await supabase
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

  const { data: employee, error: empError } = await supabase
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
  const { data: entries } = await supabase
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
    const { data: clients } = await supabase
      .from('client_entries')
      .select('client_name, procedure_name, amount_earned, tip_amount, tip_received_cash')
      .eq('time_entry_id', entry.id);

    const { data: products } = await supabase
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

// Get all employees
app.get('/api/admin/employees', async (req, res) => {
  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, name, pin, email, hourly_wage, commission_rate, pay_type, created_at');

  res.json(employees || []);
});

// Add new employee
app.post('/api/admin/employees', async (req, res) => {
  const { name, pin, email, hourlyWage, commissionRate, payType } = req.body;

  // Check if PIN already exists
  const { data: existing } = await supabase
    .from('employees')
    .select('id')
    .eq('pin', pin)
    .single();

  if (existing) {
    return res.status(400).json({ success: false, message: 'PIN already exists' });
  }

  const { data: employee, error } = await supabase
    .from('employees')
    .insert({
      name: name,
      pin: pin,
      email: email || null,
      hourly_wage: hourlyWage || 0,
      commission_rate: commissionRate || 0,
      pay_type: payType || 'hourly'
    })
    .select()
    .single();

  if (error) {
    res.status(400).json({ success: false, message: error.message });
  } else {
    res.json({ success: true, id: employee.id });
  }
});

// Update employee
app.put('/api/admin/employees/:id', async (req, res) => {
  const { id } = req.params;
  const { name, pin, email, hourlyWage, commissionRate, payType } = req.body;

  // Check if PIN already exists for another employee
  const { data: existing } = await supabase
    .from('employees')
    .select('id')
    .eq('pin', pin)
    .neq('id', parseInt(id))
    .single();

  if (existing) {
    return res.status(400).json({ success: false, message: 'PIN already exists' });
  }

  const { error } = await supabase
    .from('employees')
    .update({
      name: name,
      pin: pin,
      email: email || null,
      hourly_wage: hourlyWage || 0,
      commission_rate: commissionRate || 0,
      pay_type: payType || 'hourly'
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
  const { data: timeEntries } = await supabase
    .from('time_entries')
    .select('id')
    .eq('employee_id', parseInt(id));

  // Delete related records
  for (const entry of (timeEntries || [])) {
    await supabase.from('product_sales').delete().eq('time_entry_id', entry.id);
    await supabase.from('client_entries').delete().eq('time_entry_id', entry.id);
  }

  await supabase.from('invoices').delete().eq('employee_id', parseInt(id));
  await supabase.from('time_entries').delete().eq('employee_id', parseInt(id));
  await supabase.from('employees').delete().eq('id', parseInt(id));

  res.json({ success: true });
});

// Get all time entries (admin view)
app.get('/api/admin/time-entries', async (req, res) => {
  const { startDate, endDate, employeeId } = req.query;

  let query = supabase
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
    const { data: clients } = await supabase
      .from('client_entries')
      .select('id, client_name, procedure_name, notes, amount_earned, tip_amount, tip_received_cash')
      .eq('time_entry_id', entry.id);

    const { data: productSales } = await supabase
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

  await supabase.from('product_sales').delete().eq('time_entry_id', parseInt(id));
  await supabase.from('client_entries').delete().eq('time_entry_id', parseInt(id));
  await supabase.from('time_entries').delete().eq('id', parseInt(id));

  res.json({ success: true });
});

// Get all invoices (admin)
app.get('/api/admin/invoices', async (req, res) => {
  const { data: invoices, error } = await supabase
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
