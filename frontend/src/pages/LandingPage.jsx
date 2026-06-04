import { useEffect } from 'react';

/* ----------------------------------------------------------------------------
 * FederCare — AI Health Network · Landing Page
 *
 * The marketing landing page is a self-contained static design (Tailwind +
 * jQuery + slick + magnific-popup + GSAP) that lives in `public/landing/`.
 * Because those animations are driven by jQuery/GSAP rather than React, we
 * serve the design as-is and simply hand the browser over to it from the `/`
 * route. Its CTA buttons link back into the SPA (e.g. /login, /register/*).
 * -------------------------------------------------------------------------- */

const LANDING_URL = '/landing/index.html';

const LandingPage = () => {
  useEffect(() => {
    window.location.replace(LANDING_URL);
  }, []);

  return null;
};

export default LandingPage;
