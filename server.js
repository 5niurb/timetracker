const express = require('express');
const initSqlJs = require('sql.js');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database file path - use /tmp for Render compatibility but also try local
const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/tmp/timetracker.db'
  : path.join(__dirname, 'timetracker.db');

let db;

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

// Initialize database
async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
      console.log('Loaded existing database from', DB_PATH);
    } catch (err) {
      console.log('Could not load database, creating new one:', err.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log('Created new database');
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pin TEXT NOT NULL UNIQUE,
      email TEXT,
      hourly_wage REAL DEFAULT 0,
      commission_rate REAL DEFAULT 0,
      pay_type TEXT DEFAULT 'hourly',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      break_minutes INTEGER DEFAULT 0,
      hours REAL NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS client_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time_entry_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      procedure_name TEXT,
      notes TEXT,
      amount_earned REAL DEFAULT 0,
      tip_amount REAL DEFAULT 0,
      tip_received_cash INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (time_entry_id) REFERENCES time_entries(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time_entry_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      sale_amount REAL DEFAULT 0,
      commission_amount REAL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (time_entry_id) REFERENCES time_entries(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      pay_period_start TEXT NOT NULL,
      pay_period_end TEXT NOT NULL,
      total_hours REAL DEFAULT 0,
      total_wages REAL DEFAULT 0,
      total_commissions REAL DEFAULT 0,
      total_tips REAL DEFAULT 0,
      total_product_commissions REAL DEFAULT 0,
      cash_tips_received REAL DEFAULT 0,
      total_payable REAL DEFAULT 0,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      email_sent INTEGER DEFAULT 0,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )
  `);

  // Migration: Add new columns if they don't exist
  const migrations = [
    { table: 'employees', column: 'hourly_wage', def: 'REAL DEFAULT 0' },
    { table: 'employees', column: 'commission_rate', def: 'REAL DEFAULT 0' },
    { table: 'employees', column: 'pay_type', def: 'TEXT DEFAULT "hourly"' },
    { table: 'employees', column: 'email', def: 'TEXT' },
    { table: 'time_entries', column: 'start_time', def: 'TEXT' },
    { table: 'time_entries', column: 'end_time', def: 'TEXT' },
    { table: 'time_entries', column: 'break_minutes', def: 'INTEGER DEFAULT 0' },
    { table: 'client_entries', column: 'notes', def: 'TEXT' },
  ];

  for (const m of migrations) {
    try {
      db.exec(`SELECT ${m.column} FROM ${m.table} LIMIT 1`);
    } catch (e) {
      try {
        db.run(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.def}`);
        console.log(`Added column ${m.column} to ${m.table}`);
      } catch (e2) {}
    }
  }

  saveDatabase();

  // Insert sample employee if none exist
  const result = db.exec('SELECT COUNT(*) as count FROM employees');
  const count = result[0]?.values[0][0] || 0;

  if (count === 0) {
    db.run('INSERT INTO employees (name, pin, hourly_wage, pay_type) VALUES (?, ?, ?, ?)',
      ['Sample Employee', '1234', 15.00, 'hourly']);
    console.log('Created sample employee with PIN: 1234');
    saveDatabase();
  }
}

// Save database to file
function saveDatabase() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('Error saving database:', err.message);
  }
}

// Helper to run queries
function runQuery(sql, params = []) {
  try {
    db.run(sql, params);
    saveDatabase();
    return { success: true, lastId: db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] };
  } catch (error) {
    console.error('Query error:', error);
    return { success: false, error: error.message };
  }
}

// Helper to get results
function getAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);

    const results = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row);
    }
    stmt.free();
    return results;
  } catch (error) {
    console.error('Query error:', error);
    return [];
  }
}

function getOne(sql, params = []) {
  const results = getAll(sql, params);
  return results[0] || null;
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
app.post('/api/verify-pin', (req, res) => {
  const { pin } = req.body;
  const employee = getOne(
    'SELECT id, name, email, hourly_wage, commission_rate, pay_type FROM employees WHERE pin = ?',
    [pin]
  );

  if (employee) {
    res.json({ success: true, employee });
  } else {
    res.json({ success: false, message: 'Invalid PIN' });
  }
});

// Change PIN
app.post('/api/change-pin', (req, res) => {
  const { employeeId, currentPin, newPin } = req.body;

  // Verify current PIN
  const employee = getOne('SELECT id FROM employees WHERE id = ? AND pin = ?', [employeeId, currentPin]);
  if (!employee) {
    return res.json({ success: false, message: 'Current PIN is incorrect' });
  }

  // Check if new PIN is already used
  const existing = getOne('SELECT id FROM employees WHERE pin = ? AND id != ?', [newPin, employeeId]);
  if (existing) {
    return res.json({ success: false, message: 'PIN already in use by another employee' });
  }

  const result = runQuery('UPDATE employees SET pin = ? WHERE id = ?', [newPin, employeeId]);
  if (result.success) {
    res.json({ success: true, message: 'PIN changed successfully' });
  } else {
    res.json({ success: false, message: 'Failed to change PIN' });
  }
});

// Check for conflicting entries
app.post('/api/check-conflict', (req, res) => {
  const { employeeId, date } = req.body;

  const existing = getOne(
    'SELECT id, start_time, end_time, hours FROM time_entries WHERE employee_id = ? AND date = ?',
    [employeeId, date]
  );

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
app.delete('/api/time-entry/:id', (req, res) => {
  const { id } = req.params;
  const { employeeId } = req.body;

  // Verify ownership
  const entry = getOne('SELECT id FROM time_entries WHERE id = ? AND employee_id = ?', [parseInt(id), employeeId]);
  if (!entry) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  runQuery('DELETE FROM product_sales WHERE time_entry_id = ?', [parseInt(id)]);
  runQuery('DELETE FROM client_entries WHERE time_entry_id = ?', [parseInt(id)]);
  runQuery('DELETE FROM time_entries WHERE id = ?', [parseInt(id)]);

  res.json({ success: true });
});

// Submit time entry with client entries and product sales
app.post('/api/time-entry', (req, res) => {
  const { employeeId, date, startTime, endTime, breakMinutes, hours, description, clients, productSales } = req.body;

  const result = runQuery(
    'INSERT INTO time_entries (employee_id, date, start_time, end_time, break_minutes, hours, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [employeeId, date, startTime || null, endTime || null, breakMinutes || 0, hours, description || '']
  );

  if (result.success) {
    const timeEntryId = result.lastId;

    // Insert client entries if provided
    if (clients && clients.length > 0) {
      for (const client of clients) {
        runQuery(
          'INSERT INTO client_entries (time_entry_id, client_name, procedure_name, notes, amount_earned, tip_amount, tip_received_cash) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [timeEntryId, client.clientName, client.procedure || '', client.notes || '', client.amountEarned || 0, client.tipAmount || 0, client.tipReceivedCash ? 1 : 0]
        );
      }
    }

    // Insert product sales if provided
    if (productSales && productSales.length > 0) {
      for (const sale of productSales) {
        runQuery(
          'INSERT INTO product_sales (time_entry_id, product_name, sale_amount, commission_amount, notes) VALUES (?, ?, ?, ?, ?)',
          [timeEntryId, sale.productName, sale.saleAmount || 0, sale.commissionAmount || 0, sale.notes || '']
        );
      }
    }

    res.json({ success: true, id: timeEntryId });
  } else {
    res.status(400).json({ success: false, message: result.error });
  }
});

// Get time entries for an employee with client entries
app.get('/api/time-entries/:employeeId', (req, res) => {
  const { employeeId } = req.params;
  const entries = getAll(
    'SELECT id, date, start_time, end_time, break_minutes, hours, description, created_at FROM time_entries WHERE employee_id = ? ORDER BY date DESC, created_at DESC',
    [parseInt(employeeId)]
  );

  // Get client entries and product sales for each time entry
  for (const entry of entries) {
    entry.clients = getAll(
      'SELECT id, client_name, procedure_name, notes, amount_earned, tip_amount, tip_received_cash FROM client_entries WHERE time_entry_id = ?',
      [entry.id]
    );
    entry.productSales = getAll(
      'SELECT id, product_name, sale_amount, commission_amount, notes FROM product_sales WHERE time_entry_id = ?',
      [entry.id]
    );
  }

  res.json(entries);
});

// Get pay period summary
app.get('/api/pay-period/:employeeId', (req, res) => {
  const { employeeId } = req.params;
  const { offset } = req.query;

  const periodOffset = parseInt(offset) || 0;
  const period = getPayPeriodByOffset(periodOffset);

  const startDate = formatDateForDB(period.start);
  const endDate = formatDateForDB(period.end);

  // Get employee info
  const employee = getOne('SELECT hourly_wage, pay_type FROM employees WHERE id = ?', [parseInt(employeeId)]);

  // Get time entries for this period
  const entries = getAll(
    'SELECT id, date, hours FROM time_entries WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC',
    [parseInt(employeeId), startDate, endDate]
  );

  let totalHours = 0;
  let totalCommissions = 0;
  let totalTips = 0;
  let totalCashTips = 0;
  let totalProductCommissions = 0;

  for (const entry of entries) {
    totalHours += entry.hours;

    // Get client entries
    const clients = getAll(
      'SELECT amount_earned, tip_amount, tip_received_cash FROM client_entries WHERE time_entry_id = ?',
      [entry.id]
    );
    for (const c of clients) {
      totalCommissions += c.amount_earned || 0;
      totalTips += c.tip_amount || 0;
      if (c.tip_received_cash) {
        totalCashTips += c.tip_amount || 0;
      }
    }

    // Get product sales
    const sales = getAll(
      'SELECT commission_amount FROM product_sales WHERE time_entry_id = ?',
      [entry.id]
    );
    for (const s of sales) {
      totalProductCommissions += s.commission_amount || 0;
    }
  }

  const hourlyWage = employee?.hourly_wage || 0;
  const totalWages = totalHours * hourlyWage;

  // Check if invoice already submitted for this period
  const existingInvoice = getOne(
    'SELECT id, submitted_at FROM invoices WHERE employee_id = ? AND pay_period_start = ? AND pay_period_end = ?',
    [parseInt(employeeId), startDate, endDate]
  );

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
    entries,
    invoiceSubmitted: !!existingInvoice,
    invoiceDate: existingInvoice?.submitted_at
  });
});

// Submit invoice
app.post('/api/submit-invoice', async (req, res) => {
  const { employeeId, periodStart, periodEnd, totalHours, totalWages, totalCommissions, totalTips, totalCashTips, totalProductCommissions, totalPayable } = req.body;

  // Check if already submitted
  const existing = getOne(
    'SELECT id FROM invoices WHERE employee_id = ? AND pay_period_start = ? AND pay_period_end = ?',
    [employeeId, periodStart, periodEnd]
  );

  if (existing) {
    return res.json({ success: false, message: 'Invoice already submitted for this pay period' });
  }

  // Get employee details
  const employee = getOne('SELECT name, email, hourly_wage FROM employees WHERE id = ?', [employeeId]);

  // Create invoice record
  const result = runQuery(
    `INSERT INTO invoices (employee_id, pay_period_start, pay_period_end, total_hours, total_wages, total_commissions, total_tips, total_product_commissions, cash_tips_received, total_payable, email_sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [employeeId, periodStart, periodEnd, totalHours, totalWages, totalCommissions, totalTips, totalProductCommissions, totalCashTips, totalPayable]
  );

  if (result.success) {
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
      runQuery('UPDATE invoices SET email_sent = 1 WHERE id = ?', [result.lastId]);
    }

    res.json({
      success: true,
      message: emailResult.sent ? 'Invoice submitted and email sent!' : 'Invoice submitted (email not configured)',
      invoiceId: result.lastId,
      emailSent: emailResult.sent
    });
  } else {
    res.json({ success: false, message: 'Failed to create invoice' });
  }
});

// Get invoice details for email preview
app.get('/api/invoice-preview/:employeeId', (req, res) => {
  const { employeeId } = req.params;
  const { periodStart, periodEnd } = req.query;

  const employee = getOne('SELECT id, name, email, hourly_wage, pay_type FROM employees WHERE id = ?', [parseInt(employeeId)]);

  if (!employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  // Get all entries for the period with details
  const entries = getAll(
    `SELECT te.id, te.date, te.start_time, te.end_time, te.hours
     FROM time_entries te
     WHERE te.employee_id = ? AND te.date BETWEEN ? AND ?
     ORDER BY te.date ASC`,
    [parseInt(employeeId), periodStart, periodEnd]
  );

  const detailedEntries = [];
  let totalHours = 0;
  let totalCommissions = 0;
  let totalTips = 0;
  let totalCashTips = 0;
  let totalProductCommissions = 0;

  for (const entry of entries) {
    const clients = getAll(
      'SELECT client_name, procedure_name, amount_earned, tip_amount, tip_received_cash FROM client_entries WHERE time_entry_id = ?',
      [entry.id]
    );

    const products = getAll(
      'SELECT product_name, sale_amount, commission_amount FROM product_sales WHERE time_entry_id = ?',
      [entry.id]
    );

    let dayCommissions = 0;
    let dayTips = 0;
    let dayCashTips = 0;
    let dayProductCommissions = 0;

    for (const c of clients) {
      dayCommissions += c.amount_earned || 0;
      dayTips += c.tip_amount || 0;
      if (c.tip_received_cash) dayCashTips += c.tip_amount || 0;
    }

    for (const p of products) {
      dayProductCommissions += p.commission_amount || 0;
    }

    totalHours += entry.hours;
    totalCommissions += dayCommissions;
    totalTips += dayTips;
    totalCashTips += dayCashTips;
    totalProductCommissions += dayProductCommissions;

    detailedEntries.push({
      date: entry.date,
      startTime: entry.start_time,
      endTime: entry.end_time,
      hours: entry.hours,
      wages: entry.hours * employee.hourly_wage,
      commissions: dayCommissions,
      productCommissions: dayProductCommissions,
      tips: dayTips,
      cashTips: dayCashTips,
      clients,
      products
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
app.get('/api/admin/employees', (req, res) => {
  const employees = getAll('SELECT id, name, pin, email, hourly_wage, commission_rate, pay_type, created_at FROM employees');
  res.json(employees);
});

// Add new employee
app.post('/api/admin/employees', (req, res) => {
  const { name, pin, email, hourlyWage, commissionRate, payType } = req.body;

  // Check if PIN already exists
  const existing = getOne('SELECT id FROM employees WHERE pin = ?', [pin]);
  if (existing) {
    return res.status(400).json({ success: false, message: 'PIN already exists' });
  }

  const result = runQuery(
    'INSERT INTO employees (name, pin, email, hourly_wage, commission_rate, pay_type) VALUES (?, ?, ?, ?, ?, ?)',
    [name, pin, email || null, hourlyWage || 0, commissionRate || 0, payType || 'hourly']
  );

  if (result.success) {
    res.json({ success: true, id: result.lastId });
  } else {
    res.status(400).json({ success: false, message: result.error });
  }
});

// Update employee
app.put('/api/admin/employees/:id', (req, res) => {
  const { id } = req.params;
  const { name, pin, email, hourlyWage, commissionRate, payType } = req.body;

  // Check if PIN already exists for another employee
  const existing = getOne('SELECT id FROM employees WHERE pin = ? AND id != ?', [pin, parseInt(id)]);
  if (existing) {
    return res.status(400).json({ success: false, message: 'PIN already exists' });
  }

  const result = runQuery(
    'UPDATE employees SET name = ?, pin = ?, email = ?, hourly_wage = ?, commission_rate = ?, pay_type = ? WHERE id = ?',
    [name, pin, email || null, hourlyWage || 0, commissionRate || 0, payType || 'hourly', parseInt(id)]
  );

  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false, message: result.error });
  }
});

// Delete employee
app.delete('/api/admin/employees/:id', (req, res) => {
  const { id } = req.params;

  // Delete related records
  const timeEntries = getAll('SELECT id FROM time_entries WHERE employee_id = ?', [parseInt(id)]);
  for (const entry of timeEntries) {
    runQuery('DELETE FROM product_sales WHERE time_entry_id = ?', [entry.id]);
    runQuery('DELETE FROM client_entries WHERE time_entry_id = ?', [entry.id]);
  }

  runQuery('DELETE FROM invoices WHERE employee_id = ?', [parseInt(id)]);
  runQuery('DELETE FROM time_entries WHERE employee_id = ?', [parseInt(id)]);
  runQuery('DELETE FROM employees WHERE id = ?', [parseInt(id)]);

  res.json({ success: true });
});

// Get all time entries (admin view)
app.get('/api/admin/time-entries', (req, res) => {
  const { startDate, endDate } = req.query;

  let sql = `
    SELECT
      te.id,
      te.date,
      te.start_time,
      te.end_time,
      te.break_minutes,
      te.hours,
      te.description,
      te.created_at,
      e.name as employee_name,
      e.id as employee_id,
      e.hourly_wage,
      e.commission_rate,
      e.pay_type
    FROM time_entries te
    JOIN employees e ON te.employee_id = e.id
  `;

  const params = [];

  if (startDate && endDate) {
    sql += ' WHERE te.date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  }

  sql += ' ORDER BY te.date DESC, te.created_at DESC';

  const entries = getAll(sql, params);

  // Get client entries and product sales for each time entry
  for (const entry of entries) {
    entry.clients = getAll(
      'SELECT id, client_name, procedure_name, notes, amount_earned, tip_amount, tip_received_cash FROM client_entries WHERE time_entry_id = ?',
      [entry.id]
    );
    entry.productSales = getAll(
      'SELECT id, product_name, sale_amount, commission_amount, notes FROM product_sales WHERE time_entry_id = ?',
      [entry.id]
    );
  }

  res.json(entries);
});

// Delete time entry (admin)
app.delete('/api/admin/time-entries/:id', (req, res) => {
  const { id } = req.params;
  runQuery('DELETE FROM product_sales WHERE time_entry_id = ?', [parseInt(id)]);
  runQuery('DELETE FROM client_entries WHERE time_entry_id = ?', [parseInt(id)]);
  runQuery('DELETE FROM time_entries WHERE id = ?', [parseInt(id)]);
  res.json({ success: true });
});

// Get all invoices (admin)
app.get('/api/admin/invoices', (req, res) => {
  const invoices = getAll(`
    SELECT i.*, e.name as employee_name
    FROM invoices i
    JOIN employees e ON i.employee_id = e.id
    ORDER BY i.submitted_at DESC
  `);
  res.json(invoices);
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
║  Default Employee PIN: 1234                                ║
║  Admin Password: Set via ADMIN_PASSWORD env var            ║
╚════════════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);
