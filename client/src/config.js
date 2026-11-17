// Runtime config from the server (/api/config), filled in by main.jsx before the app renders
export const config = {
  googleClientId: '',
  calendarScopes: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy',
  calendarEnabled: true,
  loginWithCalendar: false,   // true: one Google Workspace sign-in also connects the calendar
  allowedDomain: '',          // e.g. virtualspheretechnologies.in — only this Workspace domain can sign in
  devLogin: false,            // local test mode: pick a test user instead of Google sign-in
  calendarSimulated: false,   // local test mode: Google Calendar is simulated
  workHours: { start: '10:00', end: '19:30', days: [1, 2, 3, 4, 5, 6] },
};
