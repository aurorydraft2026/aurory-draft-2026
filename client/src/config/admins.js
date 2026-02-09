// Super Admins - these users automatically get admin privileges
// IMPORTANT: Get your UID by logging in and checking Firebase Console > Authentication > Users
export const SUPER_ADMIN_EMAILS = [
  'aurorydraft@gmail.com'
];

// Store admin UIDs here once you know them
// To find your UID: Login to the app, then go to Firebase Console > Authentication > Users
// Copy your UID and add it to this array
export const SUPER_ADMIN_UIDS = [
  'fWp7xeLNvuTD9axrPtJpp4afC1g2' // Replace with your actual Firebase UID after logging in
];

// Check if an email is a super admin
export const isSuperAdmin = (email) => {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
};

// Check if a UID is a super admin
export const isSuperAdminByUid = (uid) => {
  if (!uid) return false;
  return SUPER_ADMIN_UIDS.includes(uid);
};

// Check if a user object is a super admin (checks both)
export const isUserSuperAdmin = (user) => {
  if (!user) return false;

  // Check by UID first (most reliable)
  if (SUPER_ADMIN_UIDS.includes(user.uid)) {
    return true;
  }

  // Fallback to email check
  const email = user.email ||
    (user.providerData && user.providerData.length > 0 ? user.providerData[0].email : null);

  return email ? SUPER_ADMIN_EMAILS.includes(email.toLowerCase()) : false;
};

// Check if a user is "staff" (Super Admin OR assigned Admin)
export const isStaff = (user) => {
  if (!user) return false;
  return isUserSuperAdmin(user) || user.role === 'admin';
};
