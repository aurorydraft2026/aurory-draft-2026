/**
 * Resolves the display name for a user based on project priorities.
 * Priority: auroryPlayerName > displayName (Google/Provider) > username > email prefix > "Unknown"
 * 
 * @param {Object} user - The user object (from Firestore or Auth)
 * @returns {string} - The resolved display name
 */
export const resolveDisplayName = (user) => {
    if (!user) return 'Unknown';

    // 1. Aurory In-Game Name (Top Priority)
    if (user.auroryPlayerName && user.auroryPlayerName.trim() !== '') {
        return user.auroryPlayerName;
    }

    // 2. Firebase Display Name (Google Account)
    if (user.displayName && user.displayName.trim() !== '') {
        return user.displayName;
    }

    // 3. Custom Username
    if (user.username && user.username.trim() !== '') {
        return user.username;
    }

    // 4. Email Prefix
    if (user.email) {
        return user.email.split('@')[0];
    }

    return 'Unknown';
};

/**
 * Resolves the avatar URL for a user based on project priorities.
 * Priority: auroryProfilePicture > photoURL > Default Avatar
 * 
 * @param {Object} user - The user object
 * @returns {string} - The resolved avatar URL
 */
export const resolveAvatar = (user) => {
    const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';

    if (!user) return DEFAULT_AVATAR;

    if (user.auroryProfilePicture && user.auroryProfilePicture !== '') {
        return user.auroryProfilePicture;
    }

    if (user.photoURL && user.photoURL !== '') {
        return user.photoURL;
    }

    return DEFAULT_AVATAR;
};
