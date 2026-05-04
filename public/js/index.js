    // State
    let currentEmployee = null;
    let currentPin = '';
    let selectedDate = new Date();
    let periodOffset = 0;
    let currentPayPeriod = null;
    let conflictEntryId = null;
    let pendingEntry = null;
    let serviceCount = 0;
    let salesCount = 0;
    let currentTab = 'entry';

    // Get current date/time in Los Angeles timezone
    function getLADate() {
      const now = new Date();
      const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      return laTime;
    }

    // Get today's date string in LA timezone (YYYY-MM-DD)
    function getLAToday() {
      const la = getLADate();
      return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, '0')}-${String(la.getDate()).padStart(2, '0')}`;
    }

    // Initialize
    document.getElementById('pin-input').addEventListener('keypress', e => {
      if (e.key === 'Enter') login();
    });

    // Tab Switching
    function switchTab(tab) {
      currentTab = tab;

      // Update tab buttons
      document.getElementById('tab-entry-btn').classList.toggle('active', tab === 'entry');
      document.getElementById('tab-review-btn').classList.toggle('active', tab === 'review');

      // Update tab content
      document.getElementById('tab-entry').classList.toggle('active', tab === 'entry');
      document.getElementById('tab-review').classList.toggle('active', tab === 'review');

      // Load review data when switching to review tab
      if (tab === 'review') {
        loadPayPeriod();
        loadReviewEntries();
      }
    }

    // Check for saved session
    const savedEmployee = sessionStorage.getItem('employee');
    const savedPin = sessionStorage.getItem('pin');
    if (savedEmployee) {
      currentEmployee = JSON.parse(savedEmployee);
      currentPin = savedPin;
      showMainScreen();
    }

    // Login
    async function login() {
      const pin = document.getElementById('pin-input').value;
      const errorEl = document.getElementById('login-error');
      errorEl.classList.remove('show');

      try {
        const response = await fetch('/api/verify-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });

        const data = await response.json();

        if (data.success) {
          currentEmployee = data.employee;
          currentPin = pin;
          sessionStorage.setItem('employee', JSON.stringify(currentEmployee));
          sessionStorage.setItem('pin', pin);
          showMainScreen();
        } else {
          errorEl.classList.add('show');
          document.getElementById('pin-input').value = '';
        }
      } catch (error) {
        errorEl.textContent = 'Connection error';
        errorEl.classList.add('show');
      }
    }

    function logout() {
      currentEmployee = null;
      currentPin = '';
      sessionStorage.removeItem('employee');
      sessionStorage.removeItem('pin');
      document.getElementById('pin-input').value = '';
      document.getElementById('login-screen').classList.add('active');
      document.getElementById('main-screen').classList.remove('active');
    }

    function showMainScreen() {
      document.getElementById('login-screen').classList.remove('active');
      document.getElementById('main-screen').classList.add('active');
      document.getElementById('employee-name').textContent = currentEmployee.name;

      // Show/hide sections based on pay type
      const payType = currentEmployee.pay_type;

      // Determine what to show
      const showServices = ['commission_services', 'hourly_services', 'hourly_all'].includes(payType);
      const showSales = ['commission_sales', 'hourly_sales', 'hourly_all'].includes(payType);

      document.getElementById('service-section').style.display = showServices ? 'block' : 'none';
      document.getElementById('sales-section').style.display = showSales ? 'block' : 'none';

      // Reset to entry tab
      switchTab('entry');

      initializeDatePicker();
      loadPayPeriod();
    }

    // Load Review Entries for Pay Review Tab
    async function loadReviewEntries() {
      if (!currentPayPeriod) return;

      const tbody = document.getElementById('review-entries-body');
      const tfoot = document.getElementById('review-entries-footer');
      tbody.innerHTML = '<tr><td colspan="9" class="no-entries">Loading...</td></tr>';
      tfoot.style.display = 'none';

      try {
        const response = await fetch(`/api/invoice-preview/${currentEmployee.id}?periodStart=${currentPayPeriod.periodStart}&periodEnd=${currentPayPeriod.periodEnd}`);
        const data = await response.json();

        if (!data.entries || data.entries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="9" class="no-entries">No entries for this pay period</td></tr>';
          return;
        }

        // Format date for display
        const formatDateShort = (dateStr) => {
          const d = new Date(dateStr + 'T00:00:00');
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
        };

        // Sort entries by date descending (most recent first)
        const sortedEntries = [...data.entries].sort((a, b) => {
          return new Date(b.date) - new Date(a.date);
        });

        // Build rows
        let rows = '';
        sortedEntries.forEach(entry => {
          const dayTotal = entry.wages + entry.commissions + entry.productCommissions + entry.tips - entry.cashTips;
          rows += `
            <tr>
              <td>${formatDateShort(entry.date)}</td>
              <td class="right">${entry.hours.toFixed(2)}</td>
              <td class="right">$${entry.wages.toFixed(2)}</td>
              <td class="right">$${entry.commissions.toFixed(2)}</td>
              <td class="right">$${entry.productCommissions.toFixed(2)}</td>
              <td class="right">$${entry.tips.toFixed(2)}</td>
              <td class="right cash-tips">${entry.cashTips > 0 ? '-$' + entry.cashTips.toFixed(2) : '-'}</td>
              <td class="right" style="font-weight: 600;">$${dayTotal.toFixed(2)}</td>
              <td class="right"><button class="btn-delete-small" onclick="deleteReviewEntry(${entry.id}, '${entry.date}')">Delete</button></td>
            </tr>
          `;
        });
        tbody.innerHTML = rows;

        // Update footer totals
        const s = data.summary;
        document.getElementById('review-total-hours').textContent = s.totalHours.toFixed(2);
        document.getElementById('review-total-wages').textContent = '$' + s.totalWages.toFixed(2);
        document.getElementById('review-total-service').textContent = '$' + s.totalCommissions.toFixed(2);
        document.getElementById('review-total-sales').textContent = '$' + s.totalProductCommissions.toFixed(2);
        document.getElementById('review-total-tips').textContent = '$' + s.totalTips.toFixed(2);
        document.getElementById('review-total-cash').textContent = '-$' + s.totalCashTips.toFixed(2);
        document.getElementById('review-total-payable').textContent = '$' + s.totalPayable.toFixed(2);
        tfoot.style.display = 'table-footer-group';

      } catch (error) {
        console.error('Error loading review entries:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="no-entries" style="color: #ff6b6b;">Error loading entries</td></tr>';
      }
    }

    // Date Picker
    function initializeDatePicker() {
      selectedDate = getLADate();
      selectedDate.setHours(0, 0, 0, 0);
      updateDateDisplay();
      buildDateWheel();
    }

    function updateDateDisplay() {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

      const dayName = days[selectedDate.getDay()];
      const month = months[selectedDate.getMonth()];
      const date = selectedDate.getDate();
      const year = selectedDate.getFullYear();

      const suffix = getOrdinalSuffix(date);

      document.getElementById('selected-day-name').textContent = dayName;
      document.getElementById('selected-full-date').textContent = `${month} ${date}${suffix}, ${year}`;
    }

    function getOrdinalSuffix(n) {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return s[(v - 20) % 10] || s[v] || s[0];
    }

    function buildDateWheel() {
      const container = document.getElementById('date-wheel-inner');
      container.innerHTML = '';

      // Use LA timezone for "today"
      const today = getLADate();
      today.setHours(0, 0, 0, 0);

      // Show 30 days back and forward
      for (let i = -30; i <= 30; i++) {
        const date = new Date(selectedDate);
        date.setDate(selectedDate.getDate() + i);

        const item = document.createElement('div');
        item.className = 'date-wheel-item';

        if (date > today) {
          item.classList.add('future');
        }

        if (i === 0) {
          item.classList.add('selected');
        }

        const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
        item.textContent = `${dayAbbr} ${date.getMonth() + 1}/${date.getDate()}`;
        item.dataset.offset = i;

        item.onclick = () => {
          if (date <= today) {
            selectDateByOffset(i);
          }
        };

        container.appendChild(item);
      }

      // Position to show selected in middle
      container.style.transform = `translateY(${-30 * 40 + 40}px)`;

      updateScrollButtons();
    }

    function scrollDate(direction) {
      // Use LA timezone for "today"
      const today = getLADate();
      today.setHours(0, 0, 0, 0);

      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() + direction);

      if (newDate <= today) {
        selectedDate = newDate;
        updateDateDisplay();
        buildDateWheel();
      }
    }

    function selectDateByOffset(offset) {
      // Use LA timezone for "today"
      const today = getLADate();
      today.setHours(0, 0, 0, 0);

      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() + offset);

      if (newDate <= today) {
        selectedDate = newDate;
        updateDateDisplay();
        buildDateWheel();
      }
    }

    function updateScrollButtons() {
      // Use LA timezone for "today"
      const today = getLADate();
      today.setHours(0, 0, 0, 0);

      const downBtn = document.getElementById('date-scroll-down');
      const nextDay = new Date(selectedDate);
      nextDay.setDate(nextDay.getDate() + 1);

      downBtn.disabled = nextDay > today;
    }

    // Time Calculation
    function calculateHours() {
      const startTime = document.getElementById('start-time').value;
      const endTime = document.getElementById('end-time').value;
      const breakMinutes = parseInt(document.getElementById('break-minutes').value) || 0;

      if (startTime && endTime) {
        const start = new Date(`2000-01-01T${startTime}`);
        let end = new Date(`2000-01-01T${endTime}`);

        if (end < start) {
          end.setDate(end.getDate() + 1);
        }

        const diffMs = end - start;
        const diffHours = (diffMs / (1000 * 60 * 60)) - (breakMinutes / 60);
        const hours = Math.max(0, diffHours);

        const totalMinutes = Math.round(hours * 60);
        const hh = Math.floor(totalMinutes / 60);
        const mm = String(totalMinutes % 60).padStart(2, '0');
        document.getElementById('calculated-time').textContent = `${hh}:${mm}`;
        document.getElementById('calculated-hours').textContent = hours.toFixed(2);
        return hours;
      }

      document.getElementById('calculated-time').textContent = '0:00';
      document.getElementById('calculated-hours').textContent = '0.00';
      return 0;
    }

    // Service Entries (renamed from Patient)
    function addServiceEntry() {
      serviceCount++;
      const container = document.getElementById('service-entries-container');

      const entry = document.createElement('div');
      entry.className = 'service-entry';
      entry.id = `service-${serviceCount}`;
      entry.innerHTML = `
        <div class="service-entry-header">
          <span class="service-entry-title">Service #${serviceCount}</span>
          <button class="remove-entry" onclick="removeServiceEntry(${serviceCount})">&times;</button>
        </div>
        <div class="form-group">
          <label>Service Description</label>
          <input type="text" class="service-client" placeholder="Service / client details">
        </div>
        <div class="form-group">
          <label>Procedure</label>
          <input type="text" class="service-name" placeholder="Procedure performed">
        </div>
        <div class="time-row">
          <div class="form-group">
            <label>Earnings ($)</label>
            <input type="number" class="service-earnings" step="0.01" min="0" placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Tip ($)</label>
            <input type="number" class="service-tip" step="0.01" min="0" placeholder="0.00">
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <input type="text" class="service-notes" placeholder="Optional notes">
        </div>
        <label class="checkbox-group">
          <input type="checkbox" class="tip-cash">
          <span>Tip received in cash (already paid out)</span>
        </label>
      `;

      container.appendChild(entry);
    }

    function removeServiceEntry(id) {
      const entry = document.getElementById(`service-${id}`);
      if (entry) entry.remove();
    }

    // Sales Entries with commission type toggle
    function addSalesEntry() {
      salesCount++;
      const container = document.getElementById('sales-entries-container');

      const entry = document.createElement('div');
      entry.className = 'sales-entry';
      entry.id = `sales-${salesCount}`;
      entry.innerHTML = `
        <div class="service-entry-header">
          <span class="service-entry-title">Sale #${salesCount}</span>
          <button class="remove-entry" onclick="removeSalesEntry(${salesCount})">&times;</button>
        </div>
        <div class="form-group">
          <label>Product Name</label>
          <input type="text" class="product-name" placeholder="Product sold">
        </div>
        <div class="form-group">
          <label>Sale Amount ($)</label>
          <input type="number" class="product-amount" step="0.01" min="0" placeholder="0.00" oninput="calculateSalesCommission(${salesCount})">
        </div>
        <div class="form-group">
          <label>Commission Type</label>
          <div class="commission-type-toggle">
            <button type="button" class="commission-type-btn active" data-type="percent" onclick="setCommissionType(${salesCount}, 'percent')">% Percentage</button>
            <button type="button" class="commission-type-btn" data-type="flat" onclick="setCommissionType(${salesCount}, 'flat')">$ Flat Amount</button>
          </div>
        </div>
        <div class="commission-calc-row">
          <div class="form-group" id="commission-input-${salesCount}">
            <label>Commission Rate (%)</label>
            <input type="number" class="commission-rate" step="0.1" min="0" placeholder="10" oninput="calculateSalesCommission(${salesCount})">
          </div>
        </div>
        <div class="calculated-commission" id="calc-commission-${salesCount}">
          <div class="label">Commission Earned</div>
          <div class="value">$0.00</div>
        </div>
        <input type="hidden" class="commission-type" value="percent">
        <input type="hidden" class="product-commission" value="0">
        <div class="form-group" style="margin-top: 12px;">
          <label>Notes</label>
          <input type="text" class="product-notes" placeholder="Optional notes">
        </div>
      `;

      container.appendChild(entry);
    }

    function removeSalesEntry(id) {
      const entry = document.getElementById(`sales-${id}`);
      if (entry) entry.remove();
    }

    // Delete entry from Pay Review
    async function deleteReviewEntry(entryId, dateStr) {
      if (!confirm(`Are you sure you want to delete the entry for ${dateStr}?`)) {
        return;
      }

      try {
        const response = await fetch(`/api/time-entry/${entryId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: currentEmployee.id })
        });

        const data = await response.json();

        if (data.success) {
          // Reload the review data
          loadPayPeriod();
          loadReviewEntries();
        } else {
          alert('Failed to delete entry: ' + (data.message || 'Unknown error'));
        }
      } catch (error) {
        console.error('Error deleting entry:', error);
        alert('Connection error while deleting entry');
      }
    }

    function setCommissionType(id, type) {
      const entry = document.getElementById(`sales-${id}`);
      if (!entry) return;

      // Update buttons
      entry.querySelectorAll('.commission-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
      });

      // Update hidden input
      entry.querySelector('.commission-type').value = type;

      // Update label
      const inputGroup = document.getElementById(`commission-input-${id}`);
      const label = inputGroup.querySelector('label');
      const input = inputGroup.querySelector('input');

      if (type === 'percent') {
        label.textContent = 'Commission Rate (%)';
        input.placeholder = '10';
      } else {
        label.textContent = 'Flat Commission ($)';
        input.placeholder = '0.00';
      }

      calculateSalesCommission(id);
    }

    function calculateSalesCommission(id) {
      const entry = document.getElementById(`sales-${id}`);
      if (!entry) return;

      const saleAmount = parseFloat(entry.querySelector('.product-amount').value) || 0;
      const commissionType = entry.querySelector('.commission-type').value;
      const rateInput = entry.querySelector('.commission-rate').value;
      const rate = parseFloat(rateInput) || 0;

      let commission = 0;
      if (commissionType === 'percent') {
        commission = saleAmount * (rate / 100);
      } else {
        commission = rate;
      }

      // Update display
      const calcDisplay = document.getElementById(`calc-commission-${id}`);
      calcDisplay.querySelector('.value').textContent = `$${commission.toFixed(2)}`;

      // Store value
      entry.querySelector('.product-commission').value = commission.toFixed(2);
    }

    // Check for conflicts
    async function checkConflict() {
      const dateStr = formatDate(selectedDate);

      try {
        const response = await fetch('/api/check-conflict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: currentEmployee.id,
            date: dateStr
          })
        });

        return await response.json();
      } catch (error) {
        console.error('Error checking conflict:', error);
        return { hasConflict: false };
      }
    }

    // Submit Entry
    async function submitEntry() {
      const hours = calculateHours();

      if (hours <= 0) {
        showError('entry-error', 'Please enter valid start and end times');
        return;
      }

      // Check for conflict
      const conflict = await checkConflict();

      if (conflict.hasConflict) {
        conflictEntryId = conflict.existingEntry.id;
        pendingEntry = gatherEntryData(hours);

        const existingHours = conflict.existingEntry.hours;
        const existingTime = conflict.existingEntry.start_time && conflict.existingEntry.end_time
          ? `${formatTime12(conflict.existingEntry.start_time)} - ${formatTime12(conflict.existingEntry.end_time)}`
          : `${existingHours} hours`;

        document.getElementById('conflict-message').innerHTML = `
          <strong>An entry already exists for ${formatDateDisplay(selectedDate)}:</strong><br><br>
          Existing entry: ${existingTime} (${existingHours.toFixed(2)} hours)<br><br>
          Do you want to <strong>delete the existing entry</strong> and replace it with your new entry?
        `;

        document.getElementById('conflict-modal').classList.add('show');
        return;
      }

      // No conflict, submit directly
      await saveEntry(gatherEntryData(hours));
    }

    function gatherEntryData(hours) {
      const clients = [];
      document.querySelectorAll('.service-entry').forEach(entry => {
        const name = entry.querySelector('.service-client').value.trim();
        const earnings = parseFloat(entry.querySelector('.service-earnings').value) || 0;
        const tip = parseFloat(entry.querySelector('.service-tip').value) || 0;
        // Include if there's a name OR any earnings/tips
        if (name || earnings > 0 || tip > 0) {
          clients.push({
            clientName: name || 'Service',
            procedure: entry.querySelector('.service-name').value.trim(),
            notes: entry.querySelector('.service-notes').value.trim(),
            amountEarned: earnings,
            tipAmount: tip,
            tipReceivedCash: entry.querySelector('.tip-cash').checked
          });
        }
      });

      const productSales = [];
      document.querySelectorAll('.sales-entry').forEach(entry => {
        const name = entry.querySelector('.product-name').value.trim();
        const amount = parseFloat(entry.querySelector('.product-amount').value) || 0;
        const commission = parseFloat(entry.querySelector('.product-commission').value) || 0;
        // Include if there's a name OR any sale amount/commission
        if (name || amount > 0 || commission > 0) {
          productSales.push({
            productName: name || 'Sale',
            saleAmount: amount,
            commissionAmount: commission,
            notes: entry.querySelector('.product-notes').value.trim()
          });
        }
      });

      return {
        employeeId: currentEmployee.id,
        date: formatDate(selectedDate),
        startTime: document.getElementById('start-time').value,
        endTime: document.getElementById('end-time').value,
        breakMinutes: parseInt(document.getElementById('break-minutes').value) || 0,
        hours,
        description: document.getElementById('entry-notes').value.trim(),
        clients,
        productSales
      };
    }

    async function overrideEntry() {
      closeConflictModal();

      // Delete existing entry
      try {
        await fetch(`/api/time-entry/${conflictEntryId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: currentEmployee.id })
        });
      } catch (error) {
        console.error('Error deleting entry:', error);
      }

      // Save new entry
      await saveEntry(pendingEntry);

      conflictEntryId = null;
      pendingEntry = null;
    }

    async function saveEntry(entryData) {
      try {
        const response = await fetch('/api/time-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entryData)
        });

        const data = await response.json();

        if (data.success) {
          showSuccess('entry-success', 'Entry saved successfully!');
          clearForm();
          loadPayPeriod();
          // Also update review tab data if it's been loaded
          if (currentTab === 'review') {
            loadReviewEntries();
          }
        } else {
          showError('entry-error', data.message || 'Failed to save entry');
        }
      } catch (error) {
        showError('entry-error', 'Connection error');
      }
    }

    function closeConflictModal() {
      document.getElementById('conflict-modal').classList.remove('show');
    }

    function clearForm() {
      document.getElementById('start-time').value = '';
      document.getElementById('end-time').value = '';
      document.getElementById('break-minutes').value = '0';
      document.getElementById('entry-notes').value = '';
      document.getElementById('calculated-time').textContent = '0:00';
      document.getElementById('calculated-hours').textContent = '0.00';
      document.getElementById('service-entries-container').innerHTML = '';
      document.getElementById('sales-entries-container').innerHTML = '';
      serviceCount = 0;
      salesCount = 0;
    }

    // Pay Period
    async function loadPayPeriod() {
      try {
        const response = await fetch(`/api/pay-period/${currentEmployee.id}?offset=${periodOffset}`);
        currentPayPeriod = await response.json();

        updatePayPeriodDisplay();

        // If on review tab, also load review entries
        if (currentTab === 'review') {
          loadReviewEntries();
        }
      } catch (error) {
        console.error('Error loading pay period:', error);
      }
    }

    function updatePayPeriodDisplay() {
      if (!currentPayPeriod) return;

      const startDate = new Date(currentPayPeriod.periodStart + 'T00:00:00');
      const endDate = new Date(currentPayPeriod.periodEnd + 'T00:00:00');

      const formatPeriodDate = (d) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[d.getMonth()]} ${d.getDate()}`;
      };

      document.getElementById('period-dates').textContent =
        `${formatPeriodDate(startDate)} - ${formatPeriodDate(endDate)}, ${endDate.getFullYear()}`;

      document.getElementById('period-hours').textContent = currentPayPeriod.totalHours.toFixed(1);
      document.getElementById('period-wages').textContent = `$${currentPayPeriod.totalWages.toFixed(0)}`;
      document.getElementById('period-commissions').textContent = `$${(currentPayPeriod.totalCommissions + currentPayPeriod.totalProductCommissions).toFixed(0)}`;
      document.getElementById('period-tips').textContent = `$${currentPayPeriod.totalTips.toFixed(0)}`;
      document.getElementById('period-total').textContent = `$${currentPayPeriod.totalPayable.toFixed(2)}`;

      // Invoice status
      const statusEl = document.getElementById('invoice-status');
      const submitBtn = document.getElementById('submit-invoice-btn');

      if (currentPayPeriod.invoiceSubmitted) {
        statusEl.className = 'invoice-status submitted';
        statusEl.textContent = `Invoice submitted on ${new Date(currentPayPeriod.invoiceDate).toLocaleDateString()}`;
        submitBtn.style.display = 'none';
      } else if (periodOffset > 0) {
        statusEl.className = 'invoice-status';
        statusEl.textContent = '';
        submitBtn.style.display = 'none';
      } else {
        statusEl.className = 'invoice-status pending';
        statusEl.textContent = 'Invoice not yet submitted';
        submitBtn.style.display = 'block';
      }

      // Disable forward button if at current period
      document.getElementById('next-period-btn').disabled = periodOffset >= 0;
    }

    function changePeriod(direction) {
      // Don't allow going to future periods
      if (direction > 0 && periodOffset >= 0) return;

      periodOffset += direction;
      loadPayPeriod();
    }

    // Invoice
    async function showInvoicePreview() {
      if (!currentPayPeriod || currentPayPeriod.invoiceSubmitted) return;

      const preview = document.getElementById('invoice-preview');
      preview.innerHTML = '<p style="text-align: center; padding: 20px;">Loading...</p>';
      document.getElementById('invoice-modal').classList.add('show');

      try {
        // Fetch detailed invoice data
        const response = await fetch(`/api/invoice-preview/${currentEmployee.id}?periodStart=${currentPayPeriod.periodStart}&periodEnd=${currentPayPeriod.periodEnd}`);
        const data = await response.json();

        if (!data.entries || data.entries.length === 0) {
          preview.innerHTML = '<p style="text-align: center; padding: 20px; color: #888;">No entries for this pay period</p>';
          return;
        }

        // Format date for display
        const formatDateShort = (dateStr) => {
          const d = new Date(dateStr + 'T00:00:00');
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
        };

        // Build daily rows
        let dailyRows = '';
        data.entries.forEach(entry => {
          const dayTotal = entry.wages + entry.commissions + entry.productCommissions + entry.tips - entry.cashTips;
          dailyRows += `
            <tr>
              <td>${formatDateShort(entry.date)}</td>
              <td style="text-align: right;">${entry.hours.toFixed(2)}</td>
              <td style="text-align: right;">$${entry.wages.toFixed(2)}</td>
              <td style="text-align: right;">$${entry.commissions.toFixed(2)}</td>
              <td style="text-align: right;">$${entry.productCommissions.toFixed(2)}</td>
              <td style="text-align: right;">$${entry.tips.toFixed(2)}</td>
              <td style="text-align: right; color: #ff6b6b;">${entry.cashTips > 0 ? '-$' + entry.cashTips.toFixed(2) : '-'}</td>
              <td style="text-align: right; font-weight: 600;">$${dayTotal.toFixed(2)}</td>
            </tr>
          `;
        });

        const summary = data.summary;

        preview.innerHTML = `
          <p style="font-size: 11px; color: #888; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.1em;">
            Pay Period: ${currentPayPeriod.periodStart} to ${currentPayPeriod.periodEnd}
          </p>
          <p style="font-size: 12px; color: #aaa; margin-bottom: 16px;">
            Hourly Rate: $${data.employee.hourlyWage}/hr
          </p>
          <div style="overflow-x: auto;">
            <table class="invoice-table" style="min-width: 600px;">
              <thead>
                <tr>
                  <th>Date</th>
                  <th style="text-align: right;">Hours</th>
                  <th style="text-align: right;">Wages</th>
                  <th style="text-align: right;">Service Comm</th>
                  <th style="text-align: right;">Sales Comm</th>
                  <th style="text-align: right;">Tips</th>
                  <th style="text-align: right;">Cash Tips</th>
                  <th style="text-align: right;">Day Total</th>
                </tr>
              </thead>
              <tbody>
                ${dailyRows}
              </tbody>
              <tfoot>
                <tr style="background: #1a1a1a;">
                  <td><strong>TOTALS</strong></td>
                  <td style="text-align: right;"><strong>${summary.totalHours.toFixed(2)}</strong></td>
                  <td style="text-align: right;"><strong>$${summary.totalWages.toFixed(2)}</strong></td>
                  <td style="text-align: right;"><strong>$${summary.totalCommissions.toFixed(2)}</strong></td>
                  <td style="text-align: right;"><strong>$${summary.totalProductCommissions.toFixed(2)}</strong></td>
                  <td style="text-align: right;"><strong>$${summary.totalTips.toFixed(2)}</strong></td>
                  <td style="text-align: right; color: #ff6b6b;"><strong>-$${summary.totalCashTips.toFixed(2)}</strong></td>
                  <td style="text-align: right; color: #6bff6b; font-size: 14px;"><strong>$${summary.totalPayable.toFixed(2)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        `;
      } catch (error) {
        console.error('Error loading invoice preview:', error);
        preview.innerHTML = '<p style="text-align: center; padding: 20px; color: #ff6b6b;">Error loading invoice details</p>';
      }
    }

    function closeInvoiceModal() {
      document.getElementById('invoice-modal').classList.remove('show');
    }

    async function submitInvoice() {
      if (!currentPayPeriod) return;

      try {
        const response = await fetch('/api/submit-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: currentEmployee.id,
            periodStart: currentPayPeriod.periodStart,
            periodEnd: currentPayPeriod.periodEnd,
            totalHours: currentPayPeriod.totalHours,
            totalWages: currentPayPeriod.totalWages,
            totalCommissions: currentPayPeriod.totalCommissions,
            totalTips: currentPayPeriod.totalTips,
            totalCashTips: currentPayPeriod.totalCashTips,
            totalProductCommissions: currentPayPeriod.totalProductCommissions,
            totalPayable: currentPayPeriod.totalPayable
          })
        });

        const data = await response.json();

        if (data.success) {
          closeInvoiceModal();
          loadPayPeriod();
          alert('Invoice submitted successfully! An email has been sent.');
        } else {
          alert(data.message || 'Failed to submit invoice');
        }
      } catch (error) {
        alert('Connection error');
      }
    }

    // PIN Change
    function showPinChangeModal() {
      document.getElementById('current-pin').value = '';
      document.getElementById('new-pin').value = '';
      document.getElementById('confirm-pin').value = '';
      document.getElementById('pin-error').classList.remove('show');
      document.getElementById('pin-success').classList.remove('show');
      document.getElementById('pin-modal').classList.add('show');
    }

    function closePinModal() {
      document.getElementById('pin-modal').classList.remove('show');
    }

    async function changePin() {
      const currentPinVal = document.getElementById('current-pin').value;
      const newPinVal = document.getElementById('new-pin').value;
      const confirmPinVal = document.getElementById('confirm-pin').value;

      if (!/^\d{4}$/.test(newPinVal)) {
        showError('pin-error', 'New PIN must be exactly 4 digits');
        return;
      }

      if (newPinVal !== confirmPinVal) {
        showError('pin-error', 'New PINs do not match');
        return;
      }

      try {
        const response = await fetch('/api/change-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: currentEmployee.id,
            currentPin: currentPinVal,
            newPin: newPinVal
          })
        });

        const data = await response.json();

        if (data.success) {
          currentPin = newPinVal;
          sessionStorage.setItem('pin', newPinVal);
          showSuccess('pin-success', 'PIN changed successfully!');
          setTimeout(closePinModal, 1500);
        } else {
          showError('pin-error', data.message || 'Failed to change PIN');
        }
      } catch (error) {
        showError('pin-error', 'Connection error');
      }
    }

    // Load Entries
    async function loadEntries() {
      try {
        const response = await fetch(`/api/time-entries/${currentEmployee.id}`);
        const entries = await response.json();

        const container = document.getElementById('entries-list');

        if (entries.length === 0) {
          container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No entries yet</p>';
          return;
        }

        container.innerHTML = entries.slice(0, 10).map(entry => {
          const date = new Date(entry.date + 'T00:00:00');
          const dateStr = formatDateDisplay(date);

          const timeStr = entry.start_time && entry.end_time
            ? `${formatTime12(entry.start_time)} - ${formatTime12(entry.end_time)}`
            : `${entry.hours.toFixed(1)} hours`;

          let totalEarnings = entry.hours * (currentEmployee.hourly_wage || 0);

          if (entry.clients) {
            entry.clients.forEach(c => {
              totalEarnings += (c.amount_earned || 0) + (c.tip_amount || 0);
            });
          }

          if (entry.productSales) {
            entry.productSales.forEach(p => {
              totalEarnings += p.commission_amount || 0;
            });
          }

          return `
            <div class="entry-item">
              <div class="entry-date">${dateStr}</div>
              <div class="entry-details">${timeStr} (${entry.hours.toFixed(2)} hours)</div>
              ${totalEarnings > 0 ? `<div class="entry-earnings">$${totalEarnings.toFixed(2)}</div>` : ''}
            </div>
          `;
        }).join('');
      } catch (error) {
        console.error('Error loading entries:', error);
      }
    }

    // Utility Functions
    function formatDate(date) {
      return date.toISOString().split('T')[0];
    }

    function formatDateDisplay(date) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

      const dayName = days[date.getDay()];
      const month = months[date.getMonth()];
      const day = date.getDate();
      const suffix = getOrdinalSuffix(day);

      return `${dayName}, ${month} ${day}${suffix}`;
    }

    function formatTime12(timeStr) {
      if (!timeStr) return '';
      const [hours, minutes] = timeStr.split(':');
      const h = parseInt(hours);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${minutes} ${ampm}`;
    }

    function showError(id, message) {
      const el = document.getElementById(id);
      el.textContent = message;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 5000);
    }

    function showSuccess(id, message) {
      const el = document.getElementById(id);
      el.textContent = message;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 3000);
    }

    // Service Worker Registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration failed'));
    }
