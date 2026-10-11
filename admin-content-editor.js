'use strict';

(function (root) {
  const maxPhotos = 10;
  function photoList(data) {
    const photos = Array.isArray(data.imageUrls) ? data.imageUrls.filter(url => typeof url === 'string' && url) : [];
    if (data.coverImage && !photos.includes(data.coverImage)) photos.unshift(data.coverImage);
    return [...new Set(photos)];
  }
  function mergePhotos(existing, added) {
    const combined = [...new Set([...existing, ...added])];
    if (combined.length > maxPhotos) throw new Error('Spots and events can have at most 10 photos. Remove existing photos first.');
    return combined;
  }
  function timeInput(value) {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(value || '').trim());
    if (!match) return '';
    let hour = Number(match[1]);
    if (Number(match[2]) > 59 || hour > (match[3] ? 12 : 23) || (match[3] && hour === 0)) return '';
    if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
  }
  function appTime(value) {
    const input = timeInput(value);
    if (!input) throw new Error('Valid start and end times are required.');
    const hour = Number(input.slice(0, 2));
    return `${hour % 12 || 12}:${input.slice(3)} ${hour < 12 ? 'AM' : 'PM'}`;
  }
  function dateInput(value) {
    const date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function json(value, label, array) {
    let parsed;
    try { parsed = JSON.parse(value); } catch (error) { throw new Error(`${label} must be valid JSON: ${error.message}`); }
    if (array ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON ${array ? 'array' : 'object'}.`);
    }
    return parsed;
  }
  function coordinate(value, limit, label) {
    if (!String(value).trim()) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) > limit) throw new Error(`${label} is out of range.`);
    return number;
  }
  function buildUpdates(values, type) {
    const title = values.title.trim();
    if (!title) throw new Error('Title is required.');
    if (!['indoor', 'outdoor', 'both'].includes(values.environment)) throw new Error('Choose a valid environment.');
    const activities = json(values.activities, 'Activities', true).map(item => {
      if (!item || typeof item.activityName !== 'string' || !item.activityName.trim() ||
          !Array.isArray(item.gear) || !item.gear.every(gear => typeof gear === 'string')) {
        throw new Error('Each activity needs an activityName and a gear array of strings.');
      }
      return { activityName: item.activityName.trim().toLowerCase(), gear: item.gear };
    });
    const links = json(values.links, 'Links', true).map(item => {
      if (!item || typeof item.label !== 'string' || typeof item.url !== 'string' ||
          !/^https?:\/\/\S+$/i.test(item.url.trim())) throw new Error('Each link needs a label and an http(s) URL.');
      return { label: item.label.trim() || 'Link', url: item.url.trim() };
    });
    const parkingType = Number(values.parking);
    if (![1, 2, 3, 4, 5].includes(parkingType)) throw new Error('Choose a valid parking option.');
    const updates = {
      title, location: values.location.trim(), description: values.description.trim(),
      latitude: coordinate(values.latitude, 90, 'Latitude'), longitude: coordinate(values.longitude, 180, 'Longitude'),
      environment: values.environment, isOutdoors: values.environment !== 'indoor', parkingType,
      cost: { isFree: values.free, tier: values.free ? 'Free' : values.costTier, notes: values.costNotes.trim() },
      activities, links, isArchived: values.archived,
    };
    if ((updates.latitude === null) !== (updates.longitude === null)) throw new Error('Provide both coordinates, or leave both blank.');
    if (type === 'events') {
      const date = new Date(`${values.date}T00:00:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || Number.isNaN(date.getTime()) || dateInput(date) !== values.date) {
        throw new Error('A valid event date is required.');
      }
      if (values.locationSpot.includes('/')) throw new Error('Linked spot ID cannot contain a slash.');
      if (values.repeat === 'Custom...' && !values.customRepeat.trim()) throw new Error('Describe the custom repeat schedule.');
      Object.assign(updates, {
        date, startTime: appTime(values.start), endTime: appTime(values.end),
        recurrence: { repeatOption: values.repeat, customValue: values.customRepeat.trim() || null },
        locationSpotId: values.locationSpot.trim() || null, enableLiveFeed: values.liveFeed,
      });
    } else {
      const schedule = json(values.schedule, 'Weekly schedule', false);
      for (const [day, hours] of Object.entries(schedule)) {
        if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(day) ||
            !hours || typeof hours.isOpen !== 'boolean') throw new Error('Each schedule day needs a valid weekday and isOpen boolean.');
        if (hours.isOpen) { appTime(hours.openTime); appTime(hours.closeTime); }
      }
      if (values.hasHours && !values.allDay && !Object.values(schedule).some(day => day.isOpen)) {
        throw new Error('Select at least one open day, or enable 24/7.');
      }
      updates.hoursOfOperation = { hasHours: values.hasHours, is24Seven: values.allDay,
        schedule: values.hasHours && !values.allDay ? schedule : null };
    }
    return updates;
  }
  const api = { maxPhotos, photoList, mergePhotos, timeInput, dateInput, buildUpdates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VarablyContentEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
