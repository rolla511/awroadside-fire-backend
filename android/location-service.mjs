const MAPBOX_GEOCODING_BASE_URL = "https://api.mapbox.com/search/geocode/v6";
const MAPBOX_ISOCHRONE_BASE_URL = "https://api.mapbox.com/isochrone/v1";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function ensureCoordinatePair(longitude, latitude) {
  const lng = toFiniteNumber(longitude);
  const lat = toFiniteNumber(latitude);
  if (lng === null || lat === null) {
    throw new Error("Longitude and latitude are required.");
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new Error("Longitude or latitude is out of range.");
  }
  return { longitude: lng, latitude: lat };
}

function encodeSearchText(value) {
  const query = normalizeString(value);
  if (!query) {
    throw new Error("A location query is required.");
  }
  return encodeURIComponent(query);
}

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMiles(from, to) {
  const earthRadiusMiles = 3958.7613;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusMiles * c).toFixed(2));
}

function mapGeocodeFeature(feature) {
  const center = Array.isArray(feature?.geometry?.coordinates)
    ? feature.geometry.coordinates
    : Array.isArray(feature?.coordinates)
      ? feature.coordinates
      : [];
  const routablePoints = Array.isArray(feature?.properties?.coordinates?.routable_points)
    ? feature.properties.coordinates.routable_points
    : [];
  const routablePoint = routablePoints[0] || null;

  return {
    mapboxId: feature?.properties?.mapbox_id || feature?.id || null,
    featureType: feature?.properties?.feature_type || null,
    name: feature?.properties?.name || feature?.text || "",
    fullAddress: feature?.properties?.full_address || feature?.place_name || "",
    placeFormatted: feature?.properties?.place_formatted || "",
    longitude: toFiniteNumber(center[0]),
    latitude: toFiniteNumber(center[1]),
    accuracy: feature?.properties?.coordinates?.accuracy || null,
    routableLongitude: routablePoint ? toFiniteNumber(routablePoint.longitude) : null,
    routableLatitude: routablePoint ? toFiniteNumber(routablePoint.latitude) : null,
    raw: feature
  };
}

export function createLocationService({
  accessToken = "",
  defaultCountry = "US",
  defaultRadiusMiles = 20,
  defaultAcceptanceWindowMinutes = 5
} = {}) {
  const token = normalizeString(accessToken);

  return {
    isConfigured() {
      return Boolean(token);
    },
    getConfig() {
      return {
        configured: Boolean(token),
        defaultCountry,
        defaultRadiusMiles,
        defaultAcceptanceWindowMinutes
      };
    },
    normalizeCoordinates(payload, longitudeField = "longitude", latitudeField = "latitude") {
      return ensureCoordinatePair(payload?.[longitudeField], payload?.[latitudeField]);
    },
    haversineMiles,
    isWithinRadius(from, to, radiusMiles = defaultRadiusMiles) {
      return haversineMiles(from, to) <= Number(radiusMiles || defaultRadiusMiles);
    },
    async forwardGeocode(query, options = {}) {
      ensureConfigured(token);
      const proximity =
        options.proximity && Number.isFinite(Number(options.proximity.longitude)) && Number.isFinite(Number(options.proximity.latitude))
          ? `${Number(options.proximity.longitude)},${Number(options.proximity.latitude)}`
          : null;
      const url = buildUrl(`${MAPBOX_GEOCODING_BASE_URL}/forward`, {
        q: decodeURIComponent(encodeSearchText(query)),
        access_token: token,
        country: normalizeString(options.country) || defaultCountry,
        limit: Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(Number(options.limit), 10)) : 5,
        autocomplete: options.autocomplete === true ? "true" : "false",
        proximity,
        types: normalizeString(options.types)
      });
      const payload = await fetchJson(url);
      return {
        query: normalizeString(query),
        features: Array.isArray(payload?.features) ? payload.features.map(mapGeocodeFeature) : []
      };
    },
    async reverseGeocode(longitude, latitude, options = {}) {
      ensureConfigured(token);
      const point = ensureCoordinatePair(longitude, latitude);
      const url = buildUrl(`${MAPBOX_GEOCODING_BASE_URL}/reverse`, {
        longitude: point.longitude,
        latitude: point.latitude,
        access_token: token,
        country: normalizeString(options.country) || defaultCountry,
        limit: Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(Number(options.limit), 10)) : 3
      });
      const payload = await fetchJson(url);
      return {
        point,
        features: Array.isArray(payload?.features) ? payload.features.map(mapGeocodeFeature) : []
      };
    },
    async getIsochrone(longitude, latitude, options = {}) {
      ensureConfigured(token);
      const point = ensureCoordinatePair(longitude, latitude);
      const profile = normalizeIsochroneProfile(options.profile);
      const contoursMinutes = Number.isFinite(Number(options.contoursMinutes))
        ? Math.max(1, Math.min(Number(options.contoursMinutes), 60))
        : defaultAcceptanceWindowMinutes;
      const polygons = options.polygons === false ? "false" : "true";
      const denoise = Number.isFinite(Number(options.denoise))
        ? Math.max(0, Math.min(Number(options.denoise), 1))
        : 1;
      const generalize = Number.isFinite(Number(options.generalize)) ? Number(options.generalize) : null;
      const url = buildUrl(
        `${MAPBOX_ISOCHRONE_BASE_URL}/${profile}/${point.longitude},${point.latitude}`,
        {
          access_token: token,
          contours_minutes: contoursMinutes,
          polygons,
          denoise,
          generalize
        }
      );
      const payload = await fetchJson(url);
      return {
        point,
        profile,
        contoursMinutes,
        featureCount: Array.isArray(payload?.features) ? payload.features.length : 0,
        featureCollection: payload
      };
    }
  };
}

function normalizeIsochroneProfile(value) {
  const profile = normalizeString(value).toLowerCase();
  if (["mapbox/driving", "mapbox/walking", "mapbox/cycling"].includes(profile)) {
    return profile;
  }
  if (profile === "walking") {
    return "mapbox/walking";
  }
  if (profile === "cycling") {
    return "mapbox/cycling";
  }
  return "mapbox/driving";
}

function ensureConfigured(token) {
  if (!token) {
    throw new Error("Mapbox access token is not configured.");
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Mapbox request failed with ${response.status}.`);
  }
  return payload;
}
