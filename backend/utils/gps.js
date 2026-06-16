 // Haversine formula — calculates distance between two GPS coordinates in meters
const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const isWithinRadius = (teacherLat, teacherLon, schoolLat, schoolLon, radiusMeters) => {
  const distance = getDistanceMeters(teacherLat, teacherLon, schoolLat, schoolLon);
  return { withinRadius: distance <= radiusMeters, distance: Math.round(distance) };
};

// Maximum device-reported accuracy we will accept (meters). A fix worse than this
// is treated as untrustworthy (typical of "Approximate" location / weak signal).
const GPS_ACCURACY_MAX = 100;
const GPS_BUFFER_MAX = 50;

/**
 * Shared GPS validation used by BOTH wifi and qr attendance.
 *
 * Implements:
 *  - configured-coordinate check (== null, so a legitimate 0 coordinate is valid)
 *  - NaN guard on submitted coords
 *  - accuracy gate: reject fixes worse than GPS_ACCURACY_MAX
 *  - bounded tolerance: effectiveRadius = gpsRadius + min(accuracy, GPS_BUFFER_MAX)
 *
 * @returns {{ ok:boolean, reason?:string, distance?:number|null, accuracy?:number|null, lat?:number, lon?:number }}
 */
function validateAttendanceGps(settings, { gpsLatitude, gpsLongitude, gpsAccuracy }) {
  if (settings.gpsLatitude == null || settings.gpsLongitude == null) {
    return { ok: false, reason: 'School GPS location not configured yet. Contact your admin.', distance: null, accuracy: null };
  }

  const lat = parseFloat(gpsLatitude);
  const lon = parseFloat(gpsLongitude);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return { ok: false, reason: 'Invalid GPS coordinates received.', distance: null, accuracy: null };
  }

  const accRaw = gpsAccuracy != null ? parseFloat(gpsAccuracy) : null;
  const acc = (accRaw != null && !Number.isNaN(accRaw)) ? accRaw : null;

  if (acc != null && acc > GPS_ACCURACY_MAX) {
    return {
      ok: false,
      reason: `GPS signal too weak (±${Math.round(acc)}m). Move to an open area and try again.`,
      distance: null,
      accuracy: acc,
    };
  }

  const buffer = Math.min(acc != null ? acc : 0, GPS_BUFFER_MAX);
  const effectiveRadius = settings.gpsRadius + buffer;

  const { withinRadius, distance } = isWithinRadius(
    lat, lon, settings.gpsLatitude, settings.gpsLongitude, effectiveRadius
  );

  if (!withinRadius) {
    return {
      ok: false,
      reason: `You are ${distance}m from school. Must be within ${settings.gpsRadius}m.`,
      distance,
      accuracy: acc,
    };
  }

  return { ok: true, distance, accuracy: acc, lat, lon };
}

module.exports = { getDistanceMeters, isWithinRadius, validateAttendanceGps, GPS_ACCURACY_MAX, GPS_BUFFER_MAX };