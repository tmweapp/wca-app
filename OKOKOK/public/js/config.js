/**
 * config.js - Configuration constants and network definitions
 *
 * This module contains:
 * - API endpoint configuration
 * - Network definitions (NETWORKS object mapping network names to IDs)
 * - All available networks list (ALL_NETWORKS array with domain, siteId, name, logo)
 * - Delay patterns for request throttling
 * - Directory synchronization delay patterns
 */

// API endpoint — uses current window origin
const API = window.location.origin;

// Network ID mappings — maps friendly names to WCA site IDs
const NETWORKS = {
  "WCA First": 1,
  "WCA Advanced Professionals": 2,
  "WCA China Global": 3,
  "WCA Inter Global": 4,
  "Lognet Global": 61,
  "Global Affinity Alliance": 98,
  "Elite Global Logistics Network": 108,
  "InFinite Connection (IFC8)": 118,
  "WCA Projects": 5,
  "WCA Dangerous Goods": 22,
  "WCA Perishables": 13,
  "WCA Time Critical": 18,
  "WCA Relocations": 15,
  "WCA Pharma": 16,
  "WCA Vendors": 38,
  "WCA eCommerce Solutions": 107,
  "WCA Live Events and Expo": 124
};

/**
 * All available WCA networks with details
 * Includes networks with dedicated domains and those on wcaworld.com
 * Also includes additional badges visible in the directory
 */
const ALL_NETWORKS = [
  // === Network con dominio dedicato ===
  { domain: "wcaprojects.com", siteId: 5, name: "WCA Projects", logo: "logos/WCAProjects.png" },
  { domain: "wcadangerousgoods.com", siteId: 22, name: "WCA Dangerous Goods", logo: "logos/WCADangerousGoods.png" },
  { domain: "wcaperishables.com", siteId: 13, name: "WCA Perishables", logo: "logos/WCAPerishables.png" },
  { domain: "wcatimecritical.com", siteId: 18, name: "WCA Time Critical", logo: "logos/WCATimeCritical.png" },
  { domain: "wcapharma.com", siteId: 16, name: "WCA Pharma", logo: "logos/WCAPharma.png" },
  { domain: "wcarelocations.com", siteId: 15, name: "WCA Relocations", logo: "logos/WCARelocations.png" },
  { domain: "wcaecommercesolutions.com", siteId: 107, name: "WCA eCommerce", logo: "logos/WCAeCommerceSolutions.png" },
  { domain: "wcaexpo.com", siteId: 124, name: "WCA Expo", logo: "logos/WCAExpo.png" },
  { domain: "lognetglobal.com", siteId: 61, name: "Lognet Global", logo: "logos/Lognet_logo.png" },
  { domain: "globalaffinityalliance.com", siteId: 98, name: "GAA", logo: "logos/GAA_logo.png" },
  { domain: "elitegln.com", siteId: 108, name: "EGLN", logo: "logos/EGLN_logo.png" },
  { domain: "ifc8.network", siteId: 118, name: "IFC8", logo: "logos/IFC8_logo.png" },
  // === Network su wcaworld.com (dominio virtuale per distinguerli) ===
  { domain: "wca-first", siteId: 1, name: "WCA First", logo: "logos/WCAFirst.png" },
  { domain: "wca-advanced", siteId: 2, name: "WCA Advanced", logo: "logos/WCAAdvancedProfessionals.png" },
  { domain: "wca-chinaglobal", siteId: 3, name: "WCA China Global", logo: "logos/WCAChinaGlobal.png" },
  { domain: "wca-interglobal", siteId: 4, name: "WCA Inter Global", logo: "logos/WCAInterGlobal.png" },
  { domain: "wca-vendors", siteId: 38, name: "WCA Vendors", logo: "logos/WCAESN_With_Tagline.png" },
  // === Badge extra (visibili nella directory WCA) ===
  { domain: "allworldshipping", siteId: 0, name: "All World Shipping", logo: "logos/AllWorldShipping.png" },
  { domain: "cass", siteId: 0, name: "CASS", logo: "logos/CASS.png" },
  { domain: "qs", siteId: 0, name: "Quality Standards", logo: "logos/QS.png" },
  { domain: "iata", siteId: 0, name: "IATA", logo: "logos/IATA.png" },
];

/**
 * Delay pattern for profile scraping (in seconds)
 * Simulates human-like behavior with variable delays
 * Cycles through the pattern and applies a 4-second pause every 19 profiles
 */
const DELAY_PATTERN = [3, 3, 2, 3, 8, 3, 5, 3, 12, 3, 4, 3, 6, 3, 9, 3, 3, 3, 10];

/**
 * Pause duration between different countries/networks (in seconds)
 */
const COUNTRY_PAUSE = 2;

/**
 * Delay pattern for directory synchronization (in seconds)
 * Used when fetching full directory listings for a country
 */
const DIR_DELAY_PATTERN = [2, 3, 4, 8, 3, 9, 1, 6, 3, 7, 4, 8, 1, 4, 2, 9];

/**
 * Get next delay for profile scraping
 * Tracks position in DELAY_PATTERN and returns next delay in milliseconds
 * Applies 4-second pause at end of each cycle
 */
let delayIndex = 0;
function getNextDelay() {
  const d = DELAY_PATTERN[delayIndex % DELAY_PATTERN.length];
  delayIndex++;
  // Reset ciclo dopo 10 profili (ogni 10 profili = pausa lunga di 15s)
  if (delayIndex % DELAY_PATTERN.length === 0) {
    return 4000; // pausa lunga fine ciclo
  }
  return d * 1000;
}

/**
 * Get next delay for directory synchronization
 * Tracks position in DIR_DELAY_PATTERN and returns next delay in milliseconds
 */
let dirDelayIndex = 0;
function getNextDirDelay() {
  const d = DIR_DELAY_PATTERN[dirDelayIndex % DIR_DELAY_PATTERN.length];
  dirDelayIndex++;
  return d * 1000;
}
