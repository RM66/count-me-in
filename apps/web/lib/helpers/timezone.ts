export interface TimezoneOption {
  value: string
  label: string
}

export const TIMEZONES: TimezoneOption[] = [
  // Pacific
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZDT, UTC+13)' },
  { value: 'Pacific/Fiji', label: 'Pacific/Fiji (FJT, UTC+12)' },

  // Asia-Pacific
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEDT, UTC+11)' },
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEDT, UTC+11)' },
  { value: 'Australia/Brisbane', label: 'Australia/Brisbane (AEST, UTC+10)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST, UTC+9)' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul (KST, UTC+9)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST, UTC+8)' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong Kong (HKT, UTC+8)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT, UTC+8)' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok (ICT, UTC+7)' },
  { value: 'Asia/Dhaka', label: 'Asia/Dhaka (BST, UTC+6)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST, UTC+5:30)' },
  { value: 'Asia/Karachi', label: 'Asia/Karachi (PKT, UTC+5)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST, UTC+4)' },
  { value: 'Asia/Riyadh', label: 'Asia/Riyadh (AST, UTC+3)' },
  { value: 'Europe/Moscow', label: 'Europe/Moscow (MSK, UTC+3)' },
  { value: 'Europe/Istanbul', label: 'Europe/Istanbul (TRT, UTC+3)' },
  { value: 'Asia/Jerusalem', label: 'Asia/Jerusalem (IST, UTC+2)' },
  { value: 'Africa/Cairo', label: 'Africa/Cairo (EET, UTC+2)' },

  // Europe
  { value: 'Europe/Athens', label: 'Europe/Athens (EET, UTC+2)' },
  { value: 'Europe/Helsinki', label: 'Europe/Helsinki (EET, UTC+2)' },
  { value: 'Europe/Belgrade', label: 'Europe/Belgrade (CET, UTC+1)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET, UTC+1)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET, UTC+1)' },
  { value: 'Europe/Rome', label: 'Europe/Rome (CET, UTC+1)' },
  { value: 'Europe/Madrid', label: 'Europe/Madrid (CET, UTC+1)' },
  { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam (CET, UTC+1)' },
  { value: 'Europe/Brussels', label: 'Europe/Brussels (CET, UTC+1)' },
  { value: 'Europe/Vienna', label: 'Europe/Vienna (CET, UTC+1)' },
  { value: 'Europe/Warsaw', label: 'Europe/Warsaw (CET, UTC+1)' },
  { value: 'Europe/Prague', label: 'Europe/Prague (CET, UTC+1)' },
  { value: 'Europe/London', label: 'Europe/London (GMT, UTC+0)' },
  { value: 'Europe/Dublin', label: 'Europe/Dublin (GMT, UTC+0)' },
  { value: 'Europe/Lisbon', label: 'Europe/Lisbon (WET, UTC+0)' },

  // Africa
  { value: 'Africa/Lagos', label: 'Africa/Lagos (WAT, UTC+1)' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST, UTC+2)' },
  { value: 'Africa/Nairobi', label: 'Africa/Nairobi (EAT, UTC+3)' },

  // Americas
  { value: 'America/New_York', label: 'America/New York (EST, UTC-5)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST, UTC-6)' },
  { value: 'America/Denver', label: 'America/Denver (MST, UTC-7)' },
  { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST, UTC-8)' },
  { value: 'America/Anchorage', label: 'America/Anchorage (AKST, UTC-9)' },
  { value: 'Pacific/Honolulu', label: 'Pacific/Honolulu (HST, UTC-10)' },
  { value: 'America/Toronto', label: 'America/Toronto (EST, UTC-5)' },
  { value: 'America/Vancouver', label: 'America/Vancouver (PST, UTC-8)' },
  { value: 'America/Mexico_City', label: 'America/Mexico City (CST, UTC-6)' },
  { value: 'America/Bogota', label: 'America/Bogota (COT, UTC-5)' },
  { value: 'America/Lima', label: 'America/Lima (PET, UTC-5)' },
  { value: 'America/Santiago', label: 'America/Santiago (CLT, UTC-3)' },
  { value: 'America/Sao_Paulo', label: 'America/São Paulo (BRT, UTC-3)' },
  { value: 'America/Buenos_Aires', label: 'America/Buenos Aires (ART, UTC-3)' },
  { value: 'Atlantic/Reykjavik', label: 'Atlantic/Reykjavik (GMT, UTC+0)' },
]
