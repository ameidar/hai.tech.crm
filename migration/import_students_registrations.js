#!/usr/bin/env node

/**
 * Import customers, students, and registrations from CSV
 * With full audit logging for potential rollback
 */

const fs = require('fs');

const API_URL = 'http://localhost:3001/api';
let TOKEN = '';

// Caches
let cyclesCache = {};
let customersCache = {};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Format: DD/MM/YYYY or DD/MM/YYYY HH:MM
  const parts = dateStr.split(' ')[0].split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/[^0-9]/g, '');
}

async function login() {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@haitech.co.il', password: 'admin123' })
  });
  const data = await res.json();
  TOKEN = data.accessToken;
  console.log('✓ Logged in successfully');
}

async function apiGet(endpoint, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      });
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(500);
    }
  }
}

async function apiPost(endpoint, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}` 
        },
        body: JSON.stringify(body)
      });
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(500);
    }
  }
}

async function loadCycles() {
  console.log('Loading cycles...');
  const result = await apiGet('/cycles?limit=500');
  const cycles = result.data || result || [];
  if (Array.isArray(cycles)) {
    for (const c of cycles) {
      cyclesCache[c.name] = c.id;
    }
  }
  console.log(`  ✓ Loaded ${Object.keys(cyclesCache).length} cycles`);
}

async function loadCustomers() {
  console.log('Loading customers...');
  const result = await apiGet('/customers?limit=2000');
  const customers = result.data || result || [];
  if (Array.isArray(customers)) {
    for (const c of customers) {
      if (c.phone) {
        customersCache[normalizePhone(c.phone)] = c;
      }
    }
  }
  console.log(`  ✓ Loaded ${Object.keys(customersCache).length} customers`);
}

async function getOrCreateCustomer(name, phone, email) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  
  if (customersCache[normalizedPhone]) {
    return customersCache[normalizedPhone];
  }
  
  console.log(`    Creating customer: ${name} (${phone})`);
  await sleep(150);
  const result = await apiPost('/customers', { 
    name,
    phone: normalizedPhone,
    email: email || undefined
  });
  
  if (result.id) {
    customersCache[normalizedPhone] = result;
    return result;
  }
  
  console.log(`    ⚠ Failed to create customer: ${JSON.stringify(result)}`);
  return null;
}

async function createStudent(customerId, name, birthDate) {
  console.log(`    Creating student: ${name}`);
  await sleep(150);
  
  const studentData = {
    customerId,
    name
  };
  
  if (birthDate) {
    studentData.birthDate = birthDate;
  }
  
  const result = await apiPost('/students', studentData);
  
  if (result.id) {
    return result;
  }
  
  console.log(`    ⚠ Failed to create student: ${JSON.stringify(result)}`);
  return null;
}

async function createRegistration(studentId, cycleId, amount, paymentMethod, registrationDate) {
  console.log(`    Creating registration...`);
  await sleep(150);
  
  // Map payment method
  let mappedPaymentMethod = 'credit';
  if (paymentMethod === 'הוראת קבע') {
    mappedPaymentMethod = 'transfer';
  } else if (paymentMethod === 'מזומן') {
    mappedPaymentMethod = 'cash';
  } else if (paymentMethod === 'אשראי') {
    mappedPaymentMethod = 'credit';
  }
  
  const regData = {
    studentId,
    registrationDate: registrationDate || new Date().toISOString().split('T')[0],
    status: 'active',
    amount: parseFloat(amount) || 0,
    paymentStatus: parseFloat(amount) > 0 ? 'paid' : 'unpaid',
    paymentMethod: mappedPaymentMethod
  };
  
  const result = await apiPost(`/cycles/${cycleId}/registrations`, regData);
  
  if (result.id) {
    return result;
  }
  
  console.log(`    ⚠ Failed to create registration: ${JSON.stringify(result)}`);
  return null;
}

async function processRow(row, audit) {
  const customerName = row['שם מלא'];
  const customerPhone = row['טלפון (שם מלא)'];
  const cycleName = row['שם המחזור (מחזור)'];
  let studentName = row['שם התלמיד/ה'];
  const studentBirthDate = parseDate(row['תאריך לידה התלמיד/ה']);
  const amount = row['סכום ששולם'];
  const paymentMethod = row['אמצעי תשלום'];
  const registrationDate = parseDate(row['תאריך הרשמה']);
  
  console.log(`\nProcessing: ${customerName} -> ${studentName || '(self)'} -> ${cycleName}`);
  
  // Find cycle
  const cycleId = cyclesCache[cycleName];
  if (!cycleId) {
    console.log(`  ✗ Cycle not found: ${cycleName}`);
    audit.push({ status: 'error', reason: 'cycle_not_found', cycleName, customerName });
    return false;
  }
  
  // Get or create customer
  const customer = await getOrCreateCustomer(customerName, customerPhone);
  if (!customer) {
    console.log(`  ✗ Failed to get/create customer`);
    audit.push({ status: 'error', reason: 'customer_failed', customerName, customerPhone });
    return false;
  }
  
  // Determine student name (use customer name if "-" or empty)
  if (!studentName || studentName === '-') {
    studentName = customerName;
  }
  
  // Create student
  const student = await createStudent(customer.id, studentName, studentBirthDate);
  if (!student) {
    console.log(`  ✗ Failed to create student`);
    audit.push({ status: 'error', reason: 'student_failed', customerName, studentName });
    return false;
  }
  
  // Create registration
  const registration = await createRegistration(student.id, cycleId, amount, paymentMethod, registrationDate);
  if (!registration) {
    console.log(`  ✗ Failed to create registration`);
    audit.push({ 
      status: 'error', 
      reason: 'registration_failed', 
      customerName, 
      studentName, 
      studentId: student.id,
      cycleId 
    });
    return false;
  }
  
  console.log(`  ✓ Success: Customer=${customer.id}, Student=${student.id}, Registration=${registration.id}`);
  
  audit.push({
    status: 'success',
    customerId: customer.id,
    customerName,
    customerPhone,
    studentId: student.id,
    studentName,
    registrationId: registration.id,
    cycleId,
    cycleName,
    amount
  });
  
  return true;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node import_students_registrations.js <csv_file>');
    process.exit(1);
  }
  
  console.log('=== Importing Customers, Students, and Registrations ===\n');
  
  // Read CSV
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} rows from CSV\n`);
  
  // Login
  await login();
  await sleep(300);
  
  // Load reference data
  await loadCycles();
  await loadCustomers();
  
  // Process each row
  const audit = [];
  let success = 0;
  let failed = 0;
  
  for (const row of rows) {
    const result = await processRow(row, audit);
    if (result) {
      success++;
    } else {
      failed++;
    }
    await sleep(200);
  }
  
  // Save audit log
  const auditPath = csvPath.replace('.csv', '_audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  console.log(`\nAudit log saved to: ${auditPath}`);
  
  console.log('\n=== Summary ===');
  console.log(`Total rows: ${rows.length}`);
  console.log(`Successful: ${success}`);
  console.log(`Failed: ${failed}`);
  
  // Show failures
  const failures = audit.filter(a => a.status === 'error');
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f.reason}: ${f.customerName} / ${f.cycleName || f.studentName}`);
    }
  }
}

main().catch(console.error);
