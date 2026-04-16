# PayTrack Employee Onboarding - 2026-04-16

## Summary

- **Total workers in source files:** 9
- **Successfully created:** 4
- **Skipped (missing data):** 5

## Created Employees

| Name | Email | Phone | PIN | Onboarding URL |
|------|-------|-------|-----|-----------------|
| Jade Gonzales | jadegonzales7@yahoo.com | 818-281-6178 | 5833 | [5833](https://paytrack.lemedspa.app/onboarding/0e821839-2ced-49e5-a715-78bd93b102ed) |
| Leena Osman | osmanleena@yahoo.com | 313-676-9732 | 3261 | [3261](https://paytrack.lemedspa.app/onboarding/241a47b7-48f2-44b2-8218-b094aa22a327) |
| Jodi Kay | Jodi.k@comcast.net | 612-867-4274 | 4396 | [4396](https://paytrack.lemedspa.app/onboarding/d359dc1b-39e7-41d9-913c-d5e9ae295935) |
| Lucine Keseyan | lckeseyan@gmail.com | (none) | 6153 | [6153](https://paytrack.lemedspa.app/onboarding/40364c00-2acb-4614-a463-eae21a1481f9) |

## Skipped Workers

| Name | Email | Phone | Reason |
|------|-------|-------|--------|
| Vayda Kasbah | (none) | (none) | No email and incomplete data; cannot onboard |
| Salakjit Hanna | (none) | (none) | No email provided; cannot contact |
| Kirti Patel | (none) | (none) | No email or contact info; cannot onboard |
| Sheila Ewart | (none) | (none) | No email or contact info; cannot onboard |
| Lea Culver | (none) | (none) | No email or contact info; cannot onboard |

## Data Schema Analysis

### Fields Present in CSV (1099 Template)
- Reference ID
- Recipient's Name
- Federal ID Number (TIN/SSN)
- Street Address (with Line 2)
- City, State, Zip
- Email
- Box 1 Nonemployee Compensation
- Federal/State/Local Tax Info
- Payer's State Info

### Fields Present in XLSX (Talent Vendor Database)
- Vendor Name (computed)
- Contractor Type (Sole Proprietor / Individual)
- TIN
- First Name, Last Name
- Mobile Phone
- Email
- Address (Line 1 & 2)
- City, Postal/Zip Code
- State & Country
- Designation/Role
- Professional Licenses (ID + Expiration)
- Insurance Info (Insurer, Coverage amounts, Expiration)
- Certifications

### Mapping to PayTrack employees Table

#### Fields Successfully Mapped
- name <- CSV "Recipient's Name" / XLSX "First Name" + "Last Name"
- email <- CSV "Email" / XLSX "Email"
- phone <- XLSX "Mobile" (CSV had no phone numbers)
- designation <- XLSX "Designation" (mapped to PayTrack enums)
- pin <- Generated (4-digit random, collision-checked against existing PINs)
- payType <- Set to "commission" for all 1099 contractors
- contractorType <- Set to "1099" for all contractors
- startDate <- Set to 2026-04-16 (current date)

#### Fields Available in Source but NOT in PayTrack employees Table

These would require the employee_onboarding table or separate schema:

**From CSV:**
- Federal ID Type indicator (1=EIN, 2=SSN, 3=ITIN, 4=ATIN)
- Tax withholding info (Federal, State, Local)
- Payer's State Number
- Phone number (CSV contains zero phone numbers)
- Address details

**From XLSX:**
- Professional Licenses (ID + Expiration date)
- Insurance coverage (Insurer, Coverage amounts, Expiration)
- Certifications
- Address details (street, city, zip - currently stored nowhere in PayTrack)
- Contractor Type nuance (Sole Proprietor vs Individual)

### Schema Gaps Requiring Resolution

1. **Address Storage:** Both files contain full addresses, but PayTrack employees table has no address field. These should be captured in employee_onboarding during the onboarding flow.

2. **Professional Credentials:** XLSX has license IDs and expiration dates; PayTrack has no field for these. Should be added to employee_onboarding schema.

3. **Insurance Information:** XLSX tracks insurer, coverage amounts, and expiration. Not currently stored in PayTrack.

4. **Phone Number Completeness:** CSV has zero phone numbers; XLSX has partial coverage (4 out of 9 workers). PayTrack employees table has phone field, but it is often null.

5. **TIN/ID Type Clarity:** CSV indicates whether TIN is SSN/EIN/ITIN/ATIN, but PayTrack doesn't track this distinction. Important for tax compliance.

6. **Compensation History:** Both files show year-to-date or historical compensation, but PayTrack only tracks ongoing rates. Historical earnings should be captured somewhere for audit/compliance.

## Onboarding Next Steps

Workers have been created with PIN assignments. They can now:

1. Access onboarding at their unique URL
2. Complete profile (address, DOB, TIN, banking info, W-9)
3. Upload professional documents (driver's license, licenses, insurance proof)
4. Attest to accuracy

**Pending manual tasks:**
- Email onboarding links to each of the 4 newly created workers
- For skipped workers (Vayda, Salakjit, Kirti, Sheila, Lea): obtain missing email addresses, then run this process again
- Monitor onboarding completion status in PayTrack dashboard
