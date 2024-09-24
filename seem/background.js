const CLIENT_ID ='c08dd0211d9247a3b9f70cc54033f6ac';
const REDIRECT_URI = 'https://hfiaballdkncfjfbnahiclnfockjnbpc.chromiumapp.org/';
const SCOPE = 'user-read-private user-read-email playlist-read-private user-library-read user-modify-playback-state user-read-playback-state';

// Remove CLIENT_SECRET and TOKEN_ENDPOINT as they are not needed

let isAudioPlaying = false;

function isSpotifyUrl(url) {
  return url.includes('open.spotify.com') || url.includes('spotify.com');
}

function checkAudioStatus() {
  chrome.storage.sync.get(['autoReplayEnabled', 'autoPauseEnabled'], (settings) => {
    chrome.tabs.query({}, (tabs) => {
      const wasPlaying = isAudioPlaying;

      // Filter out Spotify tabs
      const nonSpotifyAudibleTabs = tabs.filter(tab => tab.audible && !isSpotifyUrl(tab.url));
      isAudioPlaying = nonSpotifyAudibleTabs.length > 0;

      if (!wasPlaying && isAudioPlaying) {
        // Non-Spotify audio started
        console.log('Non-Spotify audio started');
        if (settings.autoPauseEnabled !== false) {
          console.log('Auto Pause is enabled, pausing music');
          pausePlayback();
        } else {
          console.log('Auto Pause is disabled, not pausing music');
        }
      } else if (wasPlaying && !isAudioPlaying) {
        // Non-Spotify audio stopped
        console.log('Non-Spotify audio stopped');
        if (settings.autoReplayEnabled !== false) {
          console.log('Auto Replay is enabled, starting music');
          startPlayback();
        } else {
          console.log('Auto Replay is disabled, not starting music');
        }
      }
    });
  });
}

chrome.alarms.create('checkAudio', { periodInMinutes: 1 / 60 }); // Check every second

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkAudio') {
    checkAudioStatus();
  }
});

async function startPlayback() {
  try {
    const { spotifyAccessToken, spotifyTokenExpiration, selectedPlaylistId } = await getStoredData([
      'spotifyAccessToken',
      'spotifyTokenExpiration',
      'selectedPlaylistId'
    ]);

    let accessToken = spotifyAccessToken;

    if (!accessToken) {
      console.error('No access token available');
      return;
    }

    // Check if token has expired
    if (Date.now() > spotifyTokenExpiration) {
      console.log('Access token expired, prompting user to log in again');
      return;
    }

    const deviceId = await getActiveDevice(accessToken);
    if (!deviceId) {
      console.error('No active Spotify device found');
      return;
    }

    const playlistId = selectedPlaylistId || 'liked';
    let trackUris;

    if (playlistId === 'liked') {
      trackUris = await getLikedSongs(accessToken);
    } else {
      trackUris = await getPlaylistTracks(accessToken, playlistId);
    }

    if (!trackUris || trackUris.length === 0) {
      console.error('No tracks found in the selected playlist');
      return;
    }

    // Start playback
    await playTracksOnDevice(accessToken, deviceId, trackUris);

    console.log('Playback started!');
  } catch (error) {
    console.error('Error starting playback:', error);
  }
}

async function pausePlayback() {
  try {
    const { spotifyAccessToken, spotifyTokenExpiration } = await getStoredData([
      'spotifyAccessToken',
      'spotifyTokenExpiration'
    ]);

    let accessToken = spotifyAccessToken;

    if (!accessToken) {
      console.error('No access token available to pause playback');
      return;
    }

    // Check if token has expired
    if (Date.now() > spotifyTokenExpiration) {
      console.log('Access token expired, prompting user to log in again');
      return;
    }

    const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error pausing playback:', errorData.error.message || 'Unknown error occurred');
      return;
    }

    console.log('Playback paused!');
  } catch (error) {
    console.error('Error pausing playback:', error);
  }
}

// Helper functions
function getStoredData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result);
    });
  });
}

function setStoredData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => {
      resolve();
    });
  });
}

async function getActiveDevice(accessToken) {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    const activeDevice = data.devices.find(device => device.is_active);
    return activeDevice ? activeDevice.id : null;
  } catch (error) {
    console.error('Error getting active device:', error);
    return null;
  }
}

async function getLikedSongs(accessToken) {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/tracks?limit=50', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.items.map(item => item.track.uri);
  } catch (error) {
    console.error('Error fetching liked songs:', error);
    return [];
  }
}

async function getPlaylistTracks(accessToken, playlistId) {
  try {
    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.items.map(item => item.track.uri);
  } catch (error) {
    console.error('Error fetching playlist tracks:', error);
    return [];
  }
}

async function playTracksOnDevice(accessToken, deviceId, trackUris) {
  const body = JSON.stringify({
    uris: trackUris.sort(() => 0.5 - Math.random()).slice(0, 50)
  });

  const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: body
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error.message || 'Unknown error occurred');
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'login') {
    const authUrl =
      `https://accounts.spotify.com/authorize` +
      `?client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(SCOPE)}`;

    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true,
      },
      (redirectUrl) => {
        if (chrome.runtime.lastError) {
          console.error('Auth error:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }

        if (redirectUrl) {
          const params = new URLSearchParams(redirectUrl.split('#')[1]);
          const accessToken = params.get('access_token');
          const expiresIn = params.get('expires_in');
          const expirationTime = Date.now() + parseInt(expiresIn, 10) * 1000;

          chrome.storage.local.set(
            {
              spotifyAccessToken: accessToken,
              spotifyTokenExpiration: expirationTime,
            },
            () => {
              console.log('Access token stored');
              sendResponse({ success: true });
            }
          );
        } else {
          sendResponse({ success: false, error: 'Redirect URL not found' });
        }
      }
    );

    return true; // Indicates we will respond asynchronously
  } else if (request.action === 'logout') {
    chrome.storage.local.remove(['spotifyAccessToken', 'spotifyTokenExpiration'], () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSpotifyToken') {
    chrome.storage.local.get(['spotifyAccessToken', 'spotifyTokenExpiration'], async (result) => {
      if (!result.spotifyAccessToken) {
        sendResponse({ success: false, error: 'No token available' });
        return;
      }

      if (Date.now() > result.spotifyTokenExpiration) {
        sendResponse({ success: false, error: 'Access token expired' });
      } else {
        sendResponse({ success: true, token: result.spotifyAccessToken });
      }
    });
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAudioStatus') {
    sendResponse({ isPlaying: isAudioPlaying });
  }
  // ... existing message handlers ...
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'playSelected') {
    chrome.tabs.query({ url: '*://open.spotify.com/*' }, (tabs) => {
      if (tabs.length === 0) {
        chrome.tabs.create({ url: 'https://open.spotify.com' }, (tab) => {
          sendResponse({ success: true, message: 'Spotify tab opened' });
        });
      } else {
        // Logic to play the selected song
        sendResponse({ success: true, message: 'Spotify tab found' });
      }
    });
    return true; // Indicates we will respond asynchronously
  }
  // ... existing message handlers ...
});