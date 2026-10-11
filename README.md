# Varably website

## Admin access

Open `admin-dashboard.html`, or use **Admin Dashboard** from the home page.
Signed-out visitors go through the existing sign-in page and return to the
admin dashboard. Access requires `users/{uid}.isAdmin == true` in the same
Firebase project as the mobile app. The dashboard watches this role and
removes its content if admin access is revoked.

The dashboard supports pending claim approval/rejection, full owner-equivalent
content editing (title, location/coordinates, description, activities/gear,
environment, parking, cost/notes, links, spot hours, event schedule/recurrence,
linked spot, live feed, photos/cover) and archiving/restoring/deleting content, account suspension,
restoration/deletion, report resolution, and suggested spot edit approval/rejection.
Account actions use the existing admin-only Firebase callable functions.
Firestore rules enforce database access; client-side role checks do not
replace those rules. Granting admin roles is not exposed in this dashboard.
Ownership, analytics counters, and billing-managed fields are preserved by the
content editor. Activities, links, and weekly hours use validated JSON fields.
Spot/event galleries are limited to 10 photos including existing and newly
uploaded photos. Approval rejects additions that would exceed capacity rather
than silently dropping submitted photos. Existing oversized galleries must be
reduced before saving photo changes; no existing photos are automatically deleted.

Records load 25 at a time. Search applies to loaded records. Refresh reloads
the current section; there are no continuous collection listeners.

Run checks with `node --test test\admin-dashboard.test.cjs test\admin-content-editor.test.cjs`.

## Publishing

These files must be published through the existing `varably-web` GitHub Pages
deployment to appear at `https://varably.com`. Include `admin-dashboard.html`
and `admin-dashboard.js` and `admin-content-editor.js` together with the updated home, sign-in, and Pro
Dashboard pages. A Flutter hot reload does not publish this website.
