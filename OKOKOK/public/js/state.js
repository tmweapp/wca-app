/**
 * state.js - Global application state variables
 *
 * This module contains all top-level global state variables used by the application:
 * - Authentication tokens and cookies
 * - Scraping state and progress tracking
 * - Country and network selection
 * - Delay index trackers for throttling
 * - Synchronization flags
 * - Notification system state
 */

// ===== Authentication =====
/**
 * Session cookies from WCA authentication
 * null until authentication is successful
 */
let sessionCookies = null;

/**
 * WCA authentication token
 * Used for API requests and authorization
 */
let wcaToken = null;

// ===== Scraping State =====
/**
 * Flag indicating if active scraping is in progress
 * true = currently scraping profiles, false = idle
 */
let scraping = false;

/**
 * Array of profiles that have been scraped in current session
 * Each profile contains scraped member data
 */
let scrapedProfiles = [];

/**
 * Total count of profiles successfully scraped
 * Updated after each successful profile save
 */
let totalScraped = 0;

// ===== Member Discovery =====
/**
 * Array of members discovered during directory discovery phase
 * Contains member objects with id, name, href, network info
 */
let discoveredMembers = [];

// ===== Country & Network Selection =====
/**
 * Array of currently selected countries for scraping
 * Contains objects with {code, name} properties
 */
let selectedCountries = [];

/**
 * Current country code being scraped
 * Used to track progress across country batches
 */
let currentScrapingCountry = "";

/**
 * Global current network mapping
 * Maps wcaId → {name, networks: [domain1, ...]}
 * Used to quickly look up member network memberships
 */
let currentNetworkMap = {};

// ===== UI State =====
/**
 * Currently active tab index
 * -1 = no tab selected, 0+ = specific tab index
 */
let activeTabIdx = -1;

/**
 * Application mode (currently hardcoded to "discover")
 * Used to determine which operations are available
 */
const currentMode = "discover";

// ===== Delay Tracking =====
/**
 * Current index in DELAY_PATTERN for profile scraping throttle
 * Managed by getNextDelay() in config.js
 * Automatically increments with each call
 */
// Note: delayIndex is actually initialized in config.js as it's tightly coupled with DELAY_PATTERN

/**
 * Current index in DIR_DELAY_PATTERN for directory sync throttle
 * Managed by getNextDirDelay() in config.js
 * Automatically increments with each call
 */
// Note: dirDelayIndex is actually initialized in config.js as it's tightly coupled with DIR_DELAY_PATTERN

// ===== Synchronization State =====
/**
 * Flag indicating if global directory synchronization is in progress
 * true = currently syncing directories across countries
 * false = sync idle or paused
 */
let dirSyncing = false;

// ===== Country Data =====
/**
 * Object mapping country codes to partner counts
 * {CC: count} e.g., {"IT": 42, "US": 128}
 * Loaded from Supabase via API and updated locally
 */
let countryPartnerCounts = {};

// ===== Notifications =====
/**
 * Flag enabling/disabling notification sounds and badge updates
 * true = notifications active, false = notifications muted
 */
let notificationsEnabled = false;

/**
 * Counter tracking total number of unread notifications
 * Incremented when new scraping results arrive
 * Displayed as badge on notification bell
 */
let notificationCount = 0;
