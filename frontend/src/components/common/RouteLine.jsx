import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-routing-machine';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';

/**
 * Draws a road route between two points on a react-leaflet map using
 * leaflet-routing-machine (OSRM). Reports distance + ETA via onRouteInfo.
 */
const RouteLine = ({ from, to, onRouteInfo }) => {
  const map = useMap();
  const controlRef = useRef(null);
  const mountedRef = useRef(true);

  // Safely tear down a routing control even if the map is already destroyed
  // (leaflet-routing-machine calls map.removeLayer internally, which throws
  // "Cannot read properties of null (reading 'removeLayer')" on a dead map).
  const safeRemove = (control) => {
    if (!control) return;
    try {
      if (map && map._loaded && map.removeControl) map.removeControl(control);
    } catch { /* map already torn down */ }
  };

  useEffect(() => {
    mountedRef.current = true;
    if (!map) return undefined;

    // Remove a stale route before drawing a fresh one.
    if (controlRef.current) {
      safeRemove(controlRef.current);
      controlRef.current = null;
    }

    if (!from?.[0] || !from?.[1] || !to?.[0] || !to?.[1]) return undefined;

    const control = L.Routing.control({
      waypoints: [L.latLng(from[0], from[1]), L.latLng(to[0], to[1])],
      routeWhileDragging: false,
      showAlternatives: false,
      fitSelectedRoutes: true,
      addWaypoints: false,
      lineOptions: {
        styles: [{ color: '#EF4444', weight: 4, opacity: 0.8 }],
      },
      createMarker: () => null,
      router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1',
      }),
      show: false,
      collapsible: true,
      collapsed: true,
    });

    // leaflet-routing-machine's internal _clearLines()/_updateLines() call
    // this._map.removeLayer/addLayer directly. Under React StrictMode (dev
    // double-mount) or a page refresh, the map can be destroyed while an OSRM
    // request is still in flight; the late _routeDone callback then runs these
    // with this._map === null → "Cannot read properties of null (reading
    // 'removeLayer')". Guard the instance methods so they no-op once the map
    // is gone. (Our routesfound listener and removeControl try/catch can't
    // cover this async internal path.)
    ['_clearLines', '_updateLines'].forEach((method) => {
      const original = control[method];
      if (typeof original === 'function') {
        control[method] = function guarded(...args) {
          if (!this._map) return undefined;
          try {
            return original.apply(this, args);
          } catch {
            return undefined; // map torn down mid-route
          }
        };
      }
    });

    control.addTo(map);

    control.on('routesfound', (e) => {
      // Ignore late callbacks that arrive after the component unmounted.
      if (!mountedRef.current) return;
      const route = e.routes[0];
      if (!route || !onRouteInfo) return;
      const distance = (route.summary.totalDistance / 1000).toFixed(1);
      const time = Math.ceil(route.summary.totalTime / 60);
      onRouteInfo({ distance: `${distance} km`, eta: `${time} mins` });
    });

    controlRef.current = control;

    return () => {
      mountedRef.current = false;
      safeRemove(control);
      controlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, from?.[0], from?.[1], to?.[0], to?.[1], onRouteInfo]);

  return null;
};

export default RouteLine;
