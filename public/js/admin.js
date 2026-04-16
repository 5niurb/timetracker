    let deleteCallback = null;
    let allEntries = [];
    let allEmployees = [];
    let currentPeriodOffset = 0; // 0 = current period, -1 = previous, etc.

    // Set default dates (LA timezone aware)
    function getLADate() {
      const now = new Date();
      return new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
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

    function getPayPeriodByOffset(offset = 0) {
      const today = getLADate();
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

    function formatDateForDB(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    function formatPeriodDisplay(start, end) {
      const options = { month: 'short', day: 'numeric' };
      const startStr = start.toLocaleDateString('en-US', options);
      const endStr = end.toLocaleDateString('en-US', { ...options, year: 'numeric' });
      return `${startStr} - ${endStr}`;
    }

    function changePayPeriod(direction) {
      currentPeriodOffset += direction;
      updatePeriodDisplay();
      loadReviewEntries();
    }

    function updatePeriodDisplay() {
      const period = getPayPeriodByOffset(currentPeriodOffset);
      document.getElementById('period-dates-display').textContent = formatPeriodDisplay(period.start, period.end);

      if (currentPeriodOffset === 0) {
        document.getElementById('period-label-display').textContent = 'Current Pay Period';
      } else if (currentPeriodOffset === -1) {
        document.getElementById('period-label-display').textContent = 'Previous Pay Period';
      } else if (currentPeriodOffset < -1) {
        document.getElementById('period-label-display').textContent = `${Math.abs(currentPeriodOffset)} Periods Ago`;
      } else {
        document.getElementById('period-label-display').textContent = 'Future Pay Period';
      }

      // Disable next button if we're at current period (can't go to future)
      document.getElementById('next-period-btn').disabled = currentPeriodOffset >= 0;
    }

    const today = getLADate();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    document.getElementById('report-start').valueAsDate = thirtyDaysAgo;
    document.getElementById('report-end').valueAsDate = today;

    document.getElementById('admin-password').addEventListener('keypress', e => {
      if (e.key === 'Enter') adminLogin();
    });

    async function adminLogin() {
      const password = document.getElementById('admin-password').value;
      const errorEl = document.getElementById('login-error');

      try {
        const response = await fetch('/api/admin/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (data.success) {
          sessionStorage.setItem('adminAuth', 'true');
          sessionStorage.setItem('adminPasswordValue', password);
          showScreen('admin-screen');
          updatePeriodDisplay();
          loadEmployeesForFilter();
          loadReviewEntries();
          loadEmployees();
        } else {
          errorEl.classList.add('show');
          document.getElementById('admin-password').value = '';
        }
      } catch (error) {
        errorEl.textContent = 'Connection error';
        errorEl.classList.add('show');
      }
    }

    function adminLogout() {
      sessionStorage.removeItem('adminAuth');
      sessionStorage.removeItem('adminPasswordValue');
      showScreen('login-screen');
      document.getElementById('admin-password').value = '';
    }

    function showScreen(screenId) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(screenId).classList.add('active');
    }

    function showTab(tabId) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

      event.target.classList.add('active');
      document.getElementById('tab-' + tabId).style.display = 'block';

      if (tabId === 'review-entries') loadReviewEntries();
      if (tabId === 'employees') loadEmployees();
      if (tabId === 'reports') loadReport();
    }

    async function loadEmployeesForFilter() {
      try {
        const response = await fetch('/api/admin/employees');
        allEmployees = await response.json();

        const select = document.getElementById('filter-employee');
        select.innerHTML = '<option value="">All Team Members</option>' +
          allEmployees.map(emp => `<option value="${emp.id}">${escapeHtml(emp.name)}</option>`).join('');
      } catch (error) {
        console.error('Error loading employees for filter:', error);
      }
    }

    async function loadReviewEntries() {
      // Get the pay period based on current offset
      const period = getPayPeriodByOffset(currentPeriodOffset);
      const startDate = formatDateForDB(period.start);
      const endDate = formatDateForDB(period.end);
      const employeeId = document.getElementById('filter-employee').value;

      let url = '/api/admin/time-entries';
      const params = [];
      params.push(`startDate=${startDate}`);
      params.push(`endDate=${endDate}`);
      if (employeeId) params.push(`employeeId=${employeeId}`);
      url += '?' + params.join('&');

      try {
        const response = await fetch(url);
        allEntries = await response.json();

        // Sort entries by date descending (most recent first)
        allEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('review-entries-table');
        const footer = document.getElementById('review-entries-footer');

        if (allEntries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No entries found</td></tr>';
          footer.style.display = 'none';
        } else {
          let totalHours = 0;
          let totalWages = 0;
          let totalServiceComm = 0;
          let totalSalesComm = 0;
          let totalTips = 0;
          let totalCashTips = 0;
          let totalPayable = 0;

          tbody.innerHTML = allEntries.map(entry => {
            const hours = parseFloat(entry.hours) || 0;
            const wages = hours * (parseFloat(entry.hourly_wage) || 0);
            let serviceComm = 0;
            let tips = 0;
            let cashTips = 0;
            let salesComm = 0;

            if (entry.clients && entry.clients.length > 0) {
              entry.clients.forEach(c => {
                serviceComm += parseFloat(c.amount_earned) || 0;
                tips += parseFloat(c.tip_amount) || 0;
                if (c.tip_received_cash) {
                  cashTips += parseFloat(c.tip_amount) || 0;
                }
              });
            }

            if (entry.productSales && entry.productSales.length > 0) {
              entry.productSales.forEach(p => {
                salesComm += parseFloat(p.commission_amount) || 0;
              });
            }

            const dayTotal = wages + serviceComm + salesComm + tips - cashTips;

            totalHours += hours;
            totalWages += wages;
            totalServiceComm += serviceComm;
            totalSalesComm += salesComm;
            totalTips += tips;
            totalCashTips += cashTips;
            totalPayable += dayTotal;

            const hasDetails = (entry.clients && entry.clients.length > 0) || (entry.productSales && entry.productSales.length > 0);

            return `
              <tr>
                <td><strong>${formatDate(entry.date)}</strong></td>
                <td>${escapeHtml(entry.employee_name)}</td>
                <td style="text-align: right;">${hours.toFixed(2)}</td>
                <td style="text-align: right;">$${wages.toFixed(2)}</td>
                <td style="text-align: right;">$${serviceComm.toFixed(2)}</td>
                <td style="text-align: right;">$${salesComm.toFixed(2)}</td>
                <td style="text-align: right;">$${tips.toFixed(2)}</td>
                <td style="text-align: right; color: #ff6b6b;">${cashTips > 0 ? '-$' + cashTips.toFixed(2) : '$0.00'}</td>
                <td style="text-align: right; color: #6bff6b; font-weight: 600;">$${dayTotal.toFixed(2)}</td>
                <td class="actions">
                  ${hasDetails ? `<button class="btn-secondary" onclick="showEntryDetails(${entry.id})">Details</button>` : ''}
                  <button class="btn-danger" onclick="confirmDeleteEntry(${entry.id})">Delete</button>
                </td>
              </tr>
            `;
          }).join('');

          // Update footer totals
          document.getElementById('review-total-hours').innerHTML = `<strong>${totalHours.toFixed(2)}</strong>`;
          document.getElementById('review-total-wages').innerHTML = `<strong>$${totalWages.toFixed(2)}</strong>`;
          document.getElementById('review-total-service').innerHTML = `<strong>$${totalServiceComm.toFixed(2)}</strong>`;
          document.getElementById('review-total-sales').innerHTML = `<strong>$${totalSalesComm.toFixed(2)}</strong>`;
          document.getElementById('review-total-tips').innerHTML = `<strong>$${totalTips.toFixed(2)}</strong>`;
          document.getElementById('review-total-cash').innerHTML = `<strong>-$${totalCashTips.toFixed(2)}</strong>`;
          document.getElementById('review-total-payable').innerHTML = `<strong>$${totalPayable.toFixed(2)}</strong>`;
          footer.style.display = '';
        }
      } catch (error) {
        console.error('Error loading review entries:', error);
      }
    }

    function showEntryDetails(entryId) {
      const entry = allEntries.find(e => e.id === entryId);
      if (!entry) return;

      const hourlyEarnings = entry.hours * (entry.hourly_wage || 0);
      let serviceEarnings = 0;
      let tips = 0;
      let tipsOwed = 0;
      let salesCommissions = 0;

      let servicesHtml = '';
      if (entry.clients && entry.clients.length > 0) {
        servicesHtml = '<div style="margin-top: 16px;"><strong style="color: #999; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;">Services & Tips:</strong>';
        entry.clients.forEach(c => {
          serviceEarnings += c.amount_earned || 0;
          tips += c.tip_amount || 0;
          if (!c.tip_received_cash) tipsOwed += c.tip_amount || 0;

          const tipStatus = c.tip_received_cash
            ? '<span class="tip-cash">Cash</span>'
            : '<span class="tip-owed">Owed</span>';

          servicesHtml += `
            <div class="patient-detail">
              <div class="patient-row">
                <span><strong style="color: #999; font-size: 10px;">PATIENT:</strong> ${escapeHtml(c.client_name)}</span>
                <span><strong style="color: #999; font-size: 10px;">SERVICES:</strong> ${escapeHtml(c.procedure_name || '-')}</span>
              </div>
              <div class="patient-row">
                <span>Earned: $${(c.amount_earned || 0).toFixed(2)}</span>
                <span>Tip: $${(c.tip_amount || 0).toFixed(2)} ${tipStatus}</span>
              </div>
            </div>
          `;
        });
        servicesHtml += '</div>';
      }

      let salesHtml = '';
      if (entry.productSales && entry.productSales.length > 0) {
        salesHtml = '<div style="margin-top: 16px;"><strong style="color: #999; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;">Sales:</strong>';
        entry.productSales.forEach(p => {
          salesCommissions += p.commission_amount || 0;
          salesHtml += `
            <div class="patient-detail">
              <div class="patient-row">
                <span><strong>${escapeHtml(p.product_name)}</strong></span>
                <span>Sale: $${(p.sale_amount || 0).toFixed(2)}</span>
              </div>
              <div class="patient-row">
                <span>Commission: $${(p.commission_amount || 0).toFixed(2)}</span>
              </div>
            </div>
          `;
        });
        salesHtml += '</div>';
      }

      const totalEarnings = hourlyEarnings + serviceEarnings + tips + salesCommissions;

      const detailsHtml = `
        <div style="margin-bottom: 16px; color: #ccc; line-height: 1.8;">
          <strong style="color: #999; font-size: 11px; letter-spacing: 0.05em;">TEAM MEMBER:</strong> ${escapeHtml(entry.employee_name)}<br>
          <strong style="color: #999; font-size: 11px; letter-spacing: 0.05em;">DATE:</strong> ${formatDate(entry.date)}<br>
          <strong style="color: #999; font-size: 11px; letter-spacing: 0.05em;">TIME:</strong> ${entry.start_time ? formatTime(entry.start_time) : '-'} - ${entry.end_time ? formatTime(entry.end_time) : '-'}<br>
          <strong style="color: #999; font-size: 11px; letter-spacing: 0.05em;">BREAK:</strong> ${entry.break_minutes || 0} minutes<br>
          <strong style="color: #999; font-size: 11px; letter-spacing: 0.05em;">HOURS:</strong> ${entry.hours.toFixed(2)}
        </div>
        ${servicesHtml}
        ${salesHtml}
        <div style="margin-top: 16px; padding: 16px; background: #1a2a1a; border: 1px solid #2a4a2a;">
          <strong style="color: #6bff6b; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;">Earnings Breakdown:</strong><br><br>
          <span style="color: #ccc;">Hourly Pay: $${hourlyEarnings.toFixed(2)}</span><br>
          <span style="color: #ccc;">Service Earnings: $${serviceEarnings.toFixed(2)}</span><br>
          <span style="color: #ccc;">Sales Commissions: $${salesCommissions.toFixed(2)}</span><br>
          <span style="color: #ccc;">Tips: $${tips.toFixed(2)} ${tipsOwed > 0 ? `<span style="color: #ff6b6b;">(${tipsOwed.toFixed(2)} owed)</span>` : ''}</span><br><br>
          <strong style="font-size: 18px; font-family: 'Cormorant Garamond', serif;">Total: $${totalEarnings.toFixed(2)}</strong>
        </div>
        ${entry.description ? `<div style="margin-top: 12px; color: #999;"><strong style="font-size: 11px; letter-spacing: 0.05em;">NOTES:</strong> ${escapeHtml(entry.description)}</div>` : ''}
      `;

      document.getElementById('entry-details-content').innerHTML = detailsHtml;
      document.getElementById('details-modal').classList.add('show');
    }

    function closeDetailsModal() {
      document.getElementById('details-modal').classList.remove('show');
    }

    async function loadEmployees() {
      try {
        const response = await fetch('/api/admin/employees');
        const employees = await response.json();

        window._employeesCache = employees;

        const tbody = document.getElementById('employees-table');

        if (employees.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No team members yet</td></tr>';
        } else {
          tbody.innerHTML = employees.map(emp => {
            const jobTypeLabel = emp.contractor_type === 'contract' ? 'Contract' : emp.contractor_type === 'employee' ? 'Full-time' : '—';

            // Build onboarding cell
            let onboardingCell;
            if (emp.onboarding_completed_at) {
              const completedDate = new Date(emp.onboarding_completed_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
              });
              onboardingCell = `
                <span style="color: #6bff6b; font-size: 11px; font-weight: 600; letter-spacing: 0.05em;">✓ COMPLETE</span>
                <br><span style="font-size: 10px; color: #666;">${completedDate}</span>
                <br><button class="btn-secondary" style="font-size: 10px; padding: 2px 8px; margin-top: 4px;" onclick="viewOnboardingDetails(${emp.id})">View Details</button>
              `;
            } else if (emp.onboarding_token) {
              onboardingCell = `
                <span style="color: #c9a84c; font-size: 11px; letter-spacing: 0.05em;">PENDING</span>
                <br><button class="btn-secondary" style="font-size: 10px; padding: 2px 8px; margin-top: 4px;" onclick="copyOnboardingLink('${emp.onboarding_token}')">Copy Link</button>
                <button class="btn-secondary" style="font-size: 10px; padding: 2px 8px; margin-top: 4px; background:#1a2a1a; border:1px solid #2a4a2a; color:#6bff6b;" onclick="openSendLink(${emp.id})">Send Link</button>
              `;
            } else {
              onboardingCell = `<span style="color: #555; font-size: 11px;">—</span>`;
            }

            return `
              <tr>
                <td><strong>${escapeHtml(emp.name)}</strong><br><span style="font-size:11px;color:#888;">${emp.email || ''}</span></td>
                <td><code style="background: #1a1a1a; padding: 4px 8px; font-size: 12px; color: #888; border: 1px solid #333;">${emp.pin}</code></td>
                <td style="font-size: 12px;">${escapeHtml(emp.designation) || '<span style="color:#555;">—</span>'}</td>
                <td style="font-size: 12px;">${jobTypeLabel}</td>
                <td>${emp.hourly_wage > 0 ? `$${parseFloat(emp.hourly_wage).toFixed(2)}` : '-'}</td>
                <td style="font-size: 11px; line-height: 1.6;">${onboardingCell}</td>
                <td class="actions">
                  <button class="btn-warning" onclick="editEmployee(${emp.id})">Edit</button>
                  <button class="btn-danger" onclick="confirmDeleteEmployee(${emp.id}, '${escapeHtml(emp.name)}')">Delete</button>
                </td>
              </tr>
            `;
          }).join('');
        }
      } catch (error) {
        console.error('Error loading employees:', error);
      }
    }

    function getPayTypeFromCheckboxes(prefix) {
      const hourly = document.getElementById(`${prefix}-hourly-check`).checked;
      const services = document.getElementById(`${prefix}-services-check`).checked;
      const sales = document.getElementById(`${prefix}-sales-check`).checked;

      if (hourly && services && sales) return 'hourly_all';
      if (hourly && services) return 'hourly_services';
      if (hourly && sales) return 'hourly_sales';
      if (hourly) return 'hourly';
      if (services && sales) return 'commission_all';
      if (services) return 'commission_services';
      if (sales) return 'commission_sales';
      return 'hourly'; // default
    }

    function setCheckboxesFromPayType(prefix, payType) {
      const hourlyCheck = document.getElementById(`${prefix}-hourly-check`);
      const servicesCheck = document.getElementById(`${prefix}-services-check`);
      const salesCheck = document.getElementById(`${prefix}-sales-check`);

      hourlyCheck.checked = ['hourly', 'hourly_services', 'hourly_sales', 'hourly_all'].includes(payType);
      servicesCheck.checked = ['commission_services', 'hourly_services', 'hourly_all', 'commission_all'].includes(payType);
      salesCheck.checked = ['commission_sales', 'hourly_sales', 'hourly_all', 'commission_all'].includes(payType);
    }

    // ============ Pre-Form (Add New Team Member) ============

    function openPreForm() {
      document.getElementById('preform-overlay').classList.add('show');
      document.getElementById('preform-fields').style.display = 'block';
      document.getElementById('preform-success').style.display = 'none';
      document.getElementById('preform-error').classList.remove('show');
      // Reset fields
      ['pf-first-name','pf-last-name','pf-email','pf-phone','pf-hourly',
       'pf-additional-pay-rate','pf-rate-notes','pf-start-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('pf-designation').value = '';
      document.getElementById('pf-contractor-type').value = '';
      document.getElementById('pf-hourly-check').checked = true;
      document.getElementById('pf-services-check').checked = false;
      document.getElementById('pf-sales-check').checked = false;
    }

    function closePreForm() {
      document.getElementById('preform-overlay').classList.remove('show');
      loadEmployees();
    }

    function copyPreFormLink() {
      const url = document.getElementById('preform-onboarding-url').value;
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('preform-copy-btn');
        btn.textContent = 'Copied!';
        btn.style.color = '#6bff6b';
        setTimeout(() => { btn.textContent = 'Copy'; btn.style.color = ''; }, 2000);
      }).catch(() => prompt('Copy this link:', url));
    }

    async function submitPreForm() {
      const firstName = document.getElementById('pf-first-name').value.trim();
      const lastName = document.getElementById('pf-last-name').value.trim();
      const name = [firstName, lastName].filter(Boolean).join(' ');
      // Auto-generate a random 4-digit PIN (can be changed later via Edit)
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      const email = document.getElementById('pf-email').value.trim();
      const phone = document.getElementById('pf-phone').value.trim();
      const designation = document.getElementById('pf-designation').value;
      const contractorType = document.getElementById('pf-contractor-type').value;
      const payType = getPayTypeFromCheckboxes('pf');
      const hourlyWage = parseFloat(document.getElementById('pf-hourly').value) || 0;
      const additionalPayRate = document.getElementById('pf-additional-pay-rate').value.trim();
      const rateNotes = document.getElementById('pf-rate-notes').value.trim();
      const startDate = document.getElementById('pf-start-date').value || null;
      const errorEl = document.getElementById('preform-error');

      errorEl.classList.remove('show');

      if (!firstName || !lastName) {
        errorEl.textContent = 'First name and last name are required';
        errorEl.classList.add('show');
        return;
      }

      try {
        const response = await fetch('/api/admin/employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, pin, email, phone, designation, contractorType,
            payType, hourlyWage,
            additionalPayRate: additionalPayRate ? parseFloat(additionalPayRate) : null,
            rateNotes, startDate,
          }),
        });

        const data = await response.json();

        if (data.success) {
          // Show success state
          const link = `${window.location.origin}/onboarding/${data.onboardingToken}`;
          document.getElementById('preform-success-name').textContent = `${name} has been added. Share the onboarding link below.`;
          document.getElementById('preform-onboarding-url').value = link;
          window._preformEmployeeId = data.id;
          window._preformEmployeeName = firstName;
          window._preformEmployeePhone = phone;
          window._preformEmployeeEmail = email;
          window._preformOnboardingLink = link;

          document.getElementById('preform-fields').style.display = 'none';
          document.getElementById('preform-success').style.display = 'block';
        } else {
          errorEl.textContent = data.message || 'Error creating team member';
          errorEl.classList.add('show');
        }
      } catch (error) {
        errorEl.textContent = 'Connection error';
        errorEl.classList.add('show');
      }
    }

    // ============ Send Link Modal ============

    let _sendLinkType = '';
    let _sendLinkEmployeeId = null;

    function openSendLink(empId) {
      _sendLinkEmployeeId = empId;
      // Find employee from cache
      const emp = (window._employeesCache || []).find(e => e.id === empId);
      const name = emp ? emp.name : (window._preformEmployeeName || 'team member');
      document.getElementById('send-link-subtitle').textContent = `Send onboarding link to ${name}`;
      document.getElementById('send-link-options').style.display = 'block';
      document.getElementById('send-link-preview-wrap').style.display = 'none';
      document.getElementById('send-link-sent').style.display = 'none';
      document.getElementById('send-link-close-wrap').style.display = 'flex';
      document.getElementById('send-link-modal').classList.add('show');
    }

    function openSendLinkEmail(empId) {
      openSendLink(empId);
      showSendPreview('email');
    }

    function showSendPreview(type) {
      _sendLinkType = type;
      const emp = (window._employeesCache || []).find(e => e.id === _sendLinkEmployeeId);
      const firstName = emp ? (emp.name || '').split(' ')[0] : (window._preformEmployeeName || '');
      const link = emp && emp.onboarding_token
        ? `${window.location.origin}/onboarding/${emp.onboarding_token}`
        : (window._preformOnboardingLink || '');

      let preview = '';
      let label = '';

      if (type === 'sms') {
        label = 'Text Message Preview (from 213-444-2242)';
        preview = `Hi ${firstName}, this is LeMed Spa. Please complete your onboarding form at the link below. The form collects your tax, license, insurance, and payment details — it takes about 10 minutes.\n\n${link}\n\nQuestions? Reply to this text or call 818-463-3772.`;
      } else {
        label = 'Email Preview (from ops@lemedspa.com)';
        preview = `Subject: LeMed Spa — Complete Your Onboarding\nTo: ${emp?.email || window._preformEmployeeEmail || '(no email on file)'}\nCC: lea@lemedspa.com\n\n---\n\nHi ${firstName},\n\nWelcome to the LeMed Spa team! Before your start date, please complete the onboarding form linked below. This collects the information needed to set up your independent contractor agreement, tax documents, and payment details.\n\n${link}\n\nThe form takes approximately 10 minutes and covers:\n- Tax information (W-9)\n- Government ID\n- Professional license(s) and insurance (if applicable)\n- Payment preferences\n\nIf you have any questions, please reach out to us at ops@lemedspa.com or call 818-463-3772.\n\nWe look forward to working with you!\n\nLeMed Spa Operations\n17414 Ventura Blvd, Encino, CA 91316\n818-4MEDSPA (818-463-3772)`;
      }

      document.getElementById('send-preview-label').textContent = label;
      document.getElementById('send-preview-body').textContent = preview;
      document.getElementById('send-link-options').style.display = 'none';
      document.getElementById('send-link-preview-wrap').style.display = 'block';
      document.getElementById('send-link-close-wrap').style.display = 'none';
    }

    function backToSendOptions() {
      document.getElementById('send-link-options').style.display = 'block';
      document.getElementById('send-link-preview-wrap').style.display = 'none';
      document.getElementById('send-link-close-wrap').style.display = 'flex';
    }

    async function confirmSendLink() {
      const btn = document.getElementById('send-confirm-btn');
      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        const password = sessionStorage.getItem('adminPasswordValue') || '';
        const response = await fetch(`/api/admin/employees/${_sendLinkEmployeeId}/send-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', password },
          body: JSON.stringify({ type: _sendLinkType }),
        });

        const data = await response.json();

        document.getElementById('send-link-preview-wrap').style.display = 'none';

        if (data.success) {
          document.getElementById('send-sent-msg').textContent = data.message;
          document.getElementById('send-link-sent').style.display = 'block';
        } else {
          document.getElementById('send-sent-msg').textContent = data.message || 'Failed to send';
          document.getElementById('send-sent-msg').style.color = '#ff6b6b';
          document.getElementById('send-link-sent').style.display = 'block';
        }

        document.getElementById('send-link-close-wrap').style.display = 'flex';
      } catch (err) {
        alert('Network error sending link');
      }

      btn.disabled = false;
      btn.textContent = 'Send';
    }

    function closeSendLinkModal() {
      document.getElementById('send-link-modal').classList.remove('show');
      document.getElementById('send-sent-msg').style.color = '';
    }

    function editEmployee(id) {
      const emp = (window._employeesCache || []).find((e) => e.id === id);
      if (!emp) return;
      document.getElementById('edit-emp-id').value = id;
      // Split name into first/last
      const nameParts = (emp.name || '').trim().split(/\s+/);
      document.getElementById('edit-emp-first-name').value = nameParts[0] || '';
      document.getElementById('edit-emp-last-name').value = nameParts.slice(1).join(' ') || '';
      document.getElementById('edit-emp-pin').value = emp.pin || '';
      document.getElementById('edit-emp-email').value = emp.email || '';
      document.getElementById('edit-emp-phone').value = emp.phone || '';
      document.getElementById('edit-emp-designation').value = emp.designation || '';
      document.getElementById('edit-emp-contractor-type').value = emp.contractor_type || '';
      setCheckboxesFromPayType('edit-emp', emp.pay_type || 'hourly');
      document.getElementById('edit-emp-hourly').value = emp.hourly_wage || '';
      document.getElementById('edit-emp-additional-pay-rate').value = emp.additional_pay_rate || '';
      document.getElementById('edit-emp-rate-notes').value = emp.rate_notes || '';
      document.getElementById('edit-error').classList.remove('show');
      document.getElementById('edit-modal').classList.add('show');
    }

    async function saveEmployee() {
      const id = document.getElementById('edit-emp-id').value;
      const firstName = document.getElementById('edit-emp-first-name').value.trim();
      const lastName = document.getElementById('edit-emp-last-name').value.trim();
      const name = [firstName, lastName].filter(Boolean).join(' ');
      const pin = document.getElementById('edit-emp-pin').value.trim();
      const email = document.getElementById('edit-emp-email').value.trim();
      const phone = document.getElementById('edit-emp-phone').value.trim();
      const designation = document.getElementById('edit-emp-designation').value;
      const contractorType = document.getElementById('edit-emp-contractor-type').value;
      const payType = getPayTypeFromCheckboxes('edit-emp');
      const hourlyWage = parseFloat(document.getElementById('edit-emp-hourly').value) || 0;
      const additionalPayRateVal = document.getElementById('edit-emp-additional-pay-rate').value.trim();
      const rateNotes = document.getElementById('edit-emp-rate-notes').value.trim();
      const errorEl = document.getElementById('edit-error');

      errorEl.classList.remove('show');

      if (!name || !pin) {
        errorEl.textContent = 'Please enter name and PIN';
        errorEl.classList.add('show');
        return;
      }

      if (!/^\d{4}$/.test(pin)) {
        errorEl.textContent = 'PIN must be exactly 4 digits';
        errorEl.classList.add('show');
        return;
      }

      try {
        const response = await fetch(`/api/admin/employees/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            pin,
            email,
            phone,
            designation,
            contractorType,
            payType,
            hourlyWage,
            additionalPayRate: additionalPayRateVal ? parseFloat(additionalPayRateVal) : null,
            rateNotes,
          }),
        });

        const data = await response.json();

        if (data.success) {
          closeEditModal();
          loadEmployees();
        } else {
          errorEl.textContent = data.message || 'Error updating employee';
          errorEl.classList.add('show');
        }
      } catch (error) {
        errorEl.textContent = 'Connection error';
        errorEl.classList.add('show');
      }
    }

    function closeEditModal() {
      document.getElementById('edit-modal').classList.remove('show');
    }

    function confirmDeleteEntry(id) {
      document.getElementById('delete-message').textContent = 'Are you sure you want to delete this time entry?';
      deleteCallback = () => deleteEntry(id);
      document.getElementById('delete-modal').classList.add('show');
    }

    function confirmDeleteEmployee(id, name) {
      document.getElementById('delete-message').textContent = `Are you sure you want to delete "${name}"? This will also delete all their time entries.`;
      deleteCallback = () => deleteEmployee(id);
      document.getElementById('delete-modal').classList.add('show');
    }

    async function deleteEntry(id) {
      try {
        await fetch(`/api/admin/time-entries/${id}`, { method: 'DELETE' });
        loadReviewEntries();
        closeDeleteModal();
      } catch (error) {
        console.error('Error deleting entry:', error);
      }
    }

    async function deleteEmployee(id) {
      try {
        await fetch(`/api/admin/employees/${id}`, { method: 'DELETE' });
        loadEmployees();
        closeDeleteModal();
      } catch (error) {
        console.error('Error deleting employee:', error);
      }
    }

    function closeDeleteModal() {
      document.getElementById('delete-modal').classList.remove('show');
      deleteCallback = null;
    }

    document.getElementById('confirm-delete-btn').addEventListener('click', () => {
      if (deleteCallback) deleteCallback();
    });

    async function loadReport() {
      const startDate = document.getElementById('report-start').value;
      const endDate = document.getElementById('report-end').value;

      try {
        let url = '/api/admin/time-entries';
        if (startDate && endDate) {
          url += `?startDate=${startDate}&endDate=${endDate}`;
        }

        const response = await fetch(url);
        const entries = await response.json();

        // Calculate totals
        let totalHours = 0;
        let totalHourlyPay = 0;
        let totalServices = 0;
        let totalSales = 0;
        let totalTips = 0;
        let totalTipsOwed = 0;

        // Group by employee
        const byEmployee = {};

        entries.forEach(e => {
          const empName = e.employee_name;
          if (!byEmployee[empName]) {
            byEmployee[empName] = {
              hours: 0,
              hourlyPay: 0,
              services: 0,
              sales: 0,
              tips: 0,
              tipsOwed: 0,
              hourlyWage: e.hourly_wage || 0
            };
          }

          byEmployee[empName].hours += e.hours;
          const hourlyEarnings = e.hours * (e.hourly_wage || 0);
          byEmployee[empName].hourlyPay += hourlyEarnings;
          totalHourlyPay += hourlyEarnings;
          totalHours += e.hours;

          if (e.clients) {
            e.clients.forEach(c => {
              byEmployee[empName].services += c.amount_earned || 0;
              byEmployee[empName].tips += c.tip_amount || 0;
              totalServices += c.amount_earned || 0;
              totalTips += c.tip_amount || 0;
              if (!c.tip_received_cash) {
                byEmployee[empName].tipsOwed += c.tip_amount || 0;
                totalTipsOwed += c.tip_amount || 0;
              }
            });
          }

          if (e.productSales) {
            e.productSales.forEach(p => {
              byEmployee[empName].sales += p.commission_amount || 0;
              totalSales += p.commission_amount || 0;
            });
          }
        });

        const grandTotal = totalHourlyPay + totalServices + totalSales + totalTips;

        // Render stats
        document.getElementById('report-stats').innerHTML = `
          <div class="stat-card">
            <div class="label">Total Hours</div>
            <div class="value">${totalHours.toFixed(1)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Hourly Pay</div>
            <div class="value">$${totalHourlyPay.toFixed(0)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Services</div>
            <div class="value">$${totalServices.toFixed(0)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Sales</div>
            <div class="value">$${totalSales.toFixed(0)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Tips</div>
            <div class="value">$${totalTips.toFixed(0)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Tips Owed</div>
            <div class="value" style="color: ${totalTipsOwed > 0 ? '#ff6b6b' : '#ffffff'};">$${totalTipsOwed.toFixed(0)}</div>
          </div>
          <div class="stat-card" style="background: #1a2a1a; border-color: #2a4a2a;">
            <div class="label" style="color: #6bff6b;">Grand Total</div>
            <div class="value" style="color: #6bff6b;">$${grandTotal.toFixed(0)}</div>
          </div>
        `;

        // Render table
        const tbody = document.getElementById('report-table');
        const employeeList = Object.entries(byEmployee).sort((a, b) =>
          (b[1].hourlyPay + b[1].services + b[1].sales + b[1].tips) - (a[1].hourlyPay + a[1].services + a[1].sales + a[1].tips)
        );

        if (employeeList.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No data for this period</td></tr>';
        } else {
          tbody.innerHTML = employeeList.map(([name, data]) => {
            const total = data.hourlyPay + data.services + data.sales + data.tips;
            return `
              <tr>
                <td><strong>${escapeHtml(name)}</strong></td>
                <td>${data.hours.toFixed(1)}h</td>
                <td>$${data.hourlyPay.toFixed(2)}</td>
                <td>$${data.services.toFixed(2)}</td>
                <td>$${data.sales.toFixed(2)}</td>
                <td>$${data.tips.toFixed(2)}</td>
                <td style="color: ${data.tipsOwed > 0 ? '#ff6b6b' : '#666'};">$${data.tipsOwed.toFixed(2)}</td>
                <td><span class="earnings-total">$${total.toFixed(2)}</span></td>
              </tr>
            `;
          }).join('');
        }
      } catch (error) {
        console.error('Error loading report:', error);
      }
    }

    function resetToCurrentPeriod() {
      currentPeriodOffset = 0;
      document.getElementById('filter-employee').value = '';
      updatePeriodDisplay();
      loadReviewEntries();
    }

    function formatDate(dateStr) {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatTime(timeStr) {
      if (!timeStr) return '';
      const [hours, minutes] = timeStr.split(':');
      const h = parseInt(hours);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${minutes} ${ampm}`;
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function copyOnboardingLink(token) {
      const link = `${window.location.origin}/onboarding/${token}`;
      navigator.clipboard.writeText(link).then(() => {
        // Flash feedback
        const btn = event.target;
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.color = '#6bff6b';
        setTimeout(() => {
          btn.textContent = original;
          btn.style.color = '';
        }, 2000);
      }).catch(() => {
        prompt('Copy this link:', link);
      });
    }

    async function viewOnboardingDetails(employeeId) {
      try {
        const password = sessionStorage.getItem('adminPasswordValue') || '';
        const response = await fetch(`/api/admin/employees/${employeeId}/onboarding`, {
          headers: { password }
        });

        if (response.status === 404) {
          alert('No onboarding data found for this employee.');
          return;
        }

        if (!response.ok) {
          alert('Error loading onboarding data.');
          return;
        }

        const data = await response.json();
        const o = data.data;
        if (!o) {
          alert('No onboarding submission found.');
          return;
        }

        const completedAt = o.submitted_at ? new Date(o.submitted_at).toLocaleString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
        }) : '—';

        function row(label, val) {
          if (!val) return '';
          return `<tr><td style="color:#888;font-size:11px;padding:6px 12px 6px 0;white-space:nowrap;vertical-align:top;">${label}</td><td style="color:#ccc;font-size:13px;padding:6px 0;">${escapeHtml(String(val))}</td></tr>`;
        }

        function section(title) {
          return `<tr><td colspan="2" style="padding:16px 0 4px;color:#c9a84c;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:600;border-bottom:1px solid #222;">${title}</td></tr>`;
        }

        // Format professional licenses array for display
        let profLicensesHtml = '';
        if (o.professional_licenses && o.professional_licenses.length > 0) {
          o.professional_licenses.forEach((lic, i) => {
            const licType = lic.type === 'Other' ? `Other (${lic.type_other || ''})` : lic.type;
            profLicensesHtml += row(`License ${i + 1} Type`, licType);
            profLicensesHtml += row(`License ${i + 1} #`, lic.number);
            profLicensesHtml += row(`License ${i + 1} Status`, lic.status);
            profLicensesHtml += row(`License ${i + 1} Expires`, lic.expiration);
            if (lic.license_url) {
              profLicensesHtml += `<tr><td style="color:#888;font-size:11px;padding:6px 12px 6px 0;white-space:nowrap;vertical-align:top;">License ${i + 1} URL</td><td style="color:#ccc;font-size:13px;padding:6px 0;"><a href="${escapeHtml(lic.license_url)}" target="_blank" style="color:#c9a84c;">${escapeHtml(lic.license_url)}</a></td></tr>`;
            }
          });
        }

        const html = `
          <table style="width:100%;border-collapse:collapse;margin-top:8px;">
            ${section('Identity')}
            ${row('First Name', o.first_name)}
            ${row('Last Name', o.last_name)}
            ${row('Date of Birth', o.date_of_birth)}
            ${row('Mobile Phone', o.mobile_phone)}
            ${section('Address')}
            ${row('Street', o.address_street)}
            ${row('City', o.address_city)}
            ${row('State', o.address_state)}
            ${row('ZIP', o.address_zip)}
            ${section('Tax (W-9)')}
            ${row('TIN Type', o.tin_type)}
            ${row('TIN (last 4)', o.tin_last4 ? `***-**-${o.tin_last4}` : '')}
            ${row('Classification', o.w9_tax_classification)}
            ${section("Driver's License")}
            ${row("DL Number", o.driver_license_number)}
            ${row("DL State", o.driver_license_state)}
            ${o.driver_license_upload_path ? `<tr><td style="color:#888;font-size:11px;padding:6px 12px 6px 0;white-space:nowrap;vertical-align:top;">DL Upload</td><td style="color:#ccc;font-size:13px;padding:6px 0;"><a href="${escapeHtml(o.driver_license_upload_path)}" target="_blank" style="color:#c9a84c;">View file</a></td></tr>` : ''}
            ${section('Professional Licenses')}
            ${profLicensesHtml || '<tr><td colspan="2" style="color:#555;font-size:12px;padding:6px 0;">None provided</td></tr>'}
            ${o.certifications ? `${section('Certifications')}${row('Certifications', o.certifications)}` : ''}
            ${section('Professional Liability Insurance')}
            ${row('Insurance Co.', o.insurance_company)}
            ${row('Policy #', o.insurance_policy_number)}
            ${row('Insurance Expires', o.insurance_expiration)}
            ${o.insurance_upload_path ? `<tr><td style="color:#888;font-size:11px;padding:6px 12px 6px 0;white-space:nowrap;vertical-align:top;">Insurance Cert</td><td style="color:#ccc;font-size:13px;padding:6px 0;"><a href="${escapeHtml(o.insurance_upload_path)}" target="_blank" style="color:#c9a84c;">View file</a></td></tr>` : ''}
            ${section('Banking')}
            ${row('Bank Name', o.bank_name)}
            ${row('Account Owner', o.bank_account_owner_name)}
            ${row('Account Type', o.bank_account_type)}
            ${row('Payment Method', o.payment_method)}
            ${row('Routing (last 4)', o.bank_routing_last4 ? `*****${o.bank_routing_last4}` : '')}
            ${row('Account (last 4)', o.bank_account_last4 ? `*****${o.bank_account_last4}` : '')}
            ${row('Zelle Contact', o.zelle_contact)}
            ${section('Contract & Attestation')}
            ${row('IC Agreement', o.ic_agreement_version)}
            ${row('Signature', o.attestation_signature)}
            ${row('Signature Date', o.attestation_date)}
            ${row('Submitted', completedAt)}
            ${row('IP Address', o.ip_address)}
          </table>
        `;

        document.getElementById('onboarding-details-content').innerHTML = html;
        document.getElementById('onboarding-modal').classList.add('show');
      } catch (error) {
        console.error('Error loading onboarding details:', error);
        alert('Failed to load onboarding details.');
      }
    }

    function closeOnboardingModal() {
      document.getElementById('onboarding-modal').classList.remove('show');
    }

    // Check if already logged in
    if (sessionStorage.getItem('adminAuth')) {
      showScreen('admin-screen');
      updatePeriodDisplay();
      loadEmployeesForFilter();
      loadReviewEntries();
      loadEmployees();
    }
