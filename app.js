const API_BASE = 'https://api.modrinth.com/v2';
const DEBOUNCE_MS = 300;

let mcVersions = [];
let targetVersion = '';
let trackedModIds = JSON.parse(localStorage.getItem('modtracker_ids') || '[]');
let trackedModsCache = {};
let debounceTimer;

const versionSelect = document.getElementById('mc-version');
const searchInput = document.getElementById('mod-search');
const searchResultsContainer = document.getElementById('search-results');
const trackedListContainer = document.getElementById('tracked-list');
const statusSummary = document.getElementById('status-summary');
const optimalVersionEl = document.getElementById('optimal-version');
const searchTemplate = document.getElementById('search-result-template');
const trackedTemplate = document.getElementById('tracked-mod-template');

async function init() {
  await fetchVersions();

  if (trackedModIds.length > 0) {
    await refreshTrackedMods();
  } else {
    renderTrackedMods();
  }

  versionSelect.addEventListener('change', (e) => {
    targetVersion = e.target.value;
    localStorage.setItem('modtracker_version', targetVersion);
    renderTrackedMods();
  });

  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();
    if (!query) {
      searchResultsContainer.innerHTML = '<div class="empty-state">Type to search for mods</div>';
      return;
    }

    searchResultsContainer.innerHTML = '<div class="empty-state"><div class="loading"></div></div>';
    debounceTimer = setTimeout(() => performSearch(query), DEBOUNCE_MS);
  });

  initThemeSwitcher();
  initBackgroundGallery();
  initTrackedSort();
  initExportImport();
}

function initExportImport() {
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importInput = document.getElementById('import-input');

  exportBtn.onclick = () => {
    const data = JSON.stringify(trackedModIds, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modtracker-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  importBtn.onclick = () => importInput.click();

  importInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const ids = JSON.parse(event.target.result);
        if (Array.isArray(ids)) {
          // Merge and deduplicate
          const newIds = [...new Set([...trackedModIds, ...ids])];
          trackedModIds = newIds;
          saveTrackedIds();
          await refreshTrackedMods();
        } else {
          alert('Invalid file format. Please upload a valid JSON array of IDs.');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to parse import file.');
      }
      importInput.value = '';
    };
    reader.readAsText(file);
  };
}

function initTrackedSort() {
  const sortSelect = document.getElementById('tracked-sort');
  if (!sortSelect) return;
  sortSelect.value = localStorage.getItem('modtracker_sort') || 'added';
  sortSelect.addEventListener('change', (e) => {
    localStorage.setItem('modtracker_sort', e.target.value);
    renderTrackedMods();
  });
}

// Themes
function initThemeSwitcher() {
  const themeInputs = document.querySelectorAll('input[name="theme-choice"]');
  const currentTheme = localStorage.getItem("tswitch-theme") || document.documentElement.dataset.theme || 'wither';
  document.documentElement.dataset.theme = currentTheme;

  themeInputs.forEach(input => {
    if (input.value === currentTheme) input.checked = true;
    input.addEventListener('change', (e) => {
      const theme = e.target.value;
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("tswitch-theme", theme);
    });
  });
}

// Gallery
function initBackgroundGallery() {
  const modal = document.getElementById('bg-gallery-modal');
  const openBtn = document.getElementById('open-gallery-btn');
  const closeBtn = document.getElementById('close-gallery-btn');
  const galleryGrid = document.getElementById('gallery-grid');
  const tooltip = document.getElementById('gallery-custom-tooltip');
  const fileInput = document.getElementById('bg-image-input');
  const randomToggle = document.getElementById('random-bg-toggle');

  // Modal controls
  openBtn.onclick = () => {
    modal.classList.add('active');
    renderGallery();
  };
  closeBtn.onclick = () => modal.classList.remove('active');
  window.onclick = (e) => { if (e.target === modal) modal.classList.remove('active'); };

  function renderGallery() {
    galleryGrid.innerHTML = '';
    const currentBg = localStorage.getItem('custom-bg-image');

    // Section 1: None
    const noneItem = document.createElement('div');
    noneItem.className = `gallery-none-card ${(!currentBg || currentBg === 'null') ? 'active' : ''}`;
    noneItem.textContent = 'None';
    noneItem.onclick = () => {
      setBackground(null);
      renderGallery();
    };
    noneItem.onmouseenter = (e) => {
      tooltip.textContent = 'Clear Background';
      tooltip.style.display = 'block';
      tooltip.style.left = e.clientX + 16 + 'px';
      tooltip.style.top = e.clientY + 16 + 'px';
    };
    noneItem.onmousemove = (e) => {
      tooltip.style.left = e.clientX + 16 + 'px';
      tooltip.style.top = e.clientY + 16 + 'px';
    };
    noneItem.onmouseleave = () => tooltip.style.display = 'none';
    galleryGrid.appendChild(noneItem);

    const categories = [
      { id: 'wallpapers', title: 'Wallpapers', images: typeof BACKGROUND_IMAGES !== 'undefined' ? BACKGROUND_IMAGES.map(s => ({ s, tiled: false, pixelated: false })) : [] },
      { id: 'paintings', title: 'Paintings', images: typeof PAINTING_IMAGES !== 'undefined' ? PAINTING_IMAGES.map(s => ({ s, tiled: false, pixelated: true })) : [] },
      { id: 'blocks', title: 'Blocks', images: typeof BLOCK_IMAGES !== 'undefined' ? BLOCK_IMAGES.map(s => ({ s, tiled: true, pixelated: true })) : [] }
    ];

    categories.forEach(cat => {
      const isActive = localStorage.getItem(`custom-bg-include-${cat.id}`) !== 'false';
      if (cat.images.length === 0) return;

      const header = document.createElement('div');
      header.className = 'gallery-section-title';
      header.textContent = cat.title;
      galleryGrid.appendChild(header);

      cat.images.forEach(imgData => {
        addGalleryItem(imgData.s, imgData.tiled, imgData.pixelated, currentBg);
      });
    });
  }

  function formatImageName(src) {
    let filename = src.split('/').pop().split('.')[0];
    filename = filename.replace(/^1920px-/, '');
    filename = filename.replace(/_\d+x\d+$/, '');
    return filename.split('_').map(word => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }

  function addGalleryItem(src, tiled, pixelated, currentBg) {
    const img = document.createElement('img');
    const isActive = (currentBg === src);
    const name = formatImageName(src);
    img.src = src;
    img.loading = 'lazy';
    img.className = `gallery-img ${tiled ? 'square' : ''} ${pixelated ? 'pixelated' : ''} ${isActive ? 'active' : ''}`;

    img.onmouseenter = (e) => {
      tooltip.textContent = name;
      tooltip.style.display = 'block';
      tooltip.style.left = e.clientX + 16 + 'px';
      tooltip.style.top = e.clientY + 16 + 'px';
    };
    img.onmousemove = (e) => {
      tooltip.style.left = e.clientX + 16 + 'px';
      tooltip.style.top = e.clientY + 16 + 'px';
    };
    img.onmouseleave = () => tooltip.style.display = 'none';

    img.onclick = () => {
      setBackground(src, tiled, pixelated);
      renderGallery();
    };
    galleryGrid.appendChild(img);
  }

  function setBackground(src, tiled, pixelated) {
    localStorage.setItem('custom-bg-random', 'false');
    randomToggle.classList.remove('active');

    if (!src) {
      document.body.style.backgroundImage = '';
      document.body.classList.remove('has-custom-bg', 'tiled', 'pixelated-bg');
      localStorage.removeItem('custom-bg-image');
      return;
    }

    applyBackground(src, tiled, pixelated);
    localStorage.setItem('custom-bg-image', src);
    localStorage.setItem('custom-bg-tiled', tiled);
    localStorage.setItem('custom-bg-pixelated', pixelated);
  }

  function applyBackground(src, tiled, pixelated) {
    document.body.style.backgroundImage = `url("${src}")`;
    document.body.classList.add('has-custom-bg');
    document.body.classList.toggle('tiled', tiled === true || tiled === 'true');
    document.body.classList.toggle('pixelated-bg', pixelated === true || pixelated === 'true');
  }

  const isRandom = localStorage.getItem('custom-bg-random') !== 'false';
  if (isRandom) randomToggle.classList.add('active');

  randomToggle.onclick = () => {
    const currentState = localStorage.getItem('custom-bg-random') !== 'false';
    const newState = !currentState;
    localStorage.setItem('custom-bg-random', newState);
    randomToggle.classList.toggle('active', newState);
  };

  ['wallpapers', 'paintings', 'blocks'].forEach(key => {
    const btn = document.getElementById(`filter-${key}`);
    const active = localStorage.getItem(`custom-bg-include-${key}`) !== 'false';
    btn.classList.toggle('active', active);
    btn.onclick = () => {
      const state = localStorage.getItem(`custom-bg-include-${key}`) !== 'false';
      localStorage.setItem(`custom-bg-include-${key}`, !state);
      btn.classList.toggle('active', !state);
      renderGallery();
    };
  });

  // Custom upload
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setBackground(event.target.result, false, false);
      reader.readAsDataURL(file);
    }
  };
}

// API Calls
async function fetchVersions() {
  try {
    const res = await fetch(`${API_BASE}/tag/game_version`);
    if (!res.ok) throw new Error('Failed to fetch versions');
    const data = await res.json();

    const releasesOnly = data.filter(v => v.version_type === 'release');
    mcVersions = releasesOnly;
    versionSelect.innerHTML = '';

    const savedVersion = localStorage.getItem('modtracker_version');
    targetVersion = savedVersion && releasesOnly.some(v => v.version === savedVersion) ? savedVersion : (releasesOnly[0] ? releasesOnly[0].version : '');

    const limitedVersions = releasesOnly.slice(0, 100);

    for (const v of limitedVersions) {
      const option = document.createElement('option');
      option.value = v.version;
      const typeLabel = v.version_type === 'release' ? '' : ` (${v.version_type})`;
      option.textContent = `${v.version}${typeLabel}`;
      if (v.version === targetVersion) {
        option.selected = true;
      }
      versionSelect.appendChild(option);
    }

    if (!limitedVersions.some(v => v.version === targetVersion)) {
      const option = document.createElement('option');
      option.value = targetVersion;
      option.textContent = targetVersion;
      option.selected = true;
      versionSelect.prepend(option);
    }

  } catch (err) {
    console.error(err);
    versionSelect.innerHTML = '<option disabled>Error loading versions</option>';
  }
}

async function performSearch(query) {
  try {
    const facets = encodeURIComponent(JSON.stringify([["project_type:mod", "project_type:datapack"]]));
    const res = await fetch(`${API_BASE}/search?query=${encodeURIComponent(query)}&facets=${facets}&limit=10`);
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();

    renderSearchResults(data.hits);
  } catch (err) {
    console.error(err);
    searchResultsContainer.innerHTML = '<div class="empty-state">Error during search</div>';
  }
}

async function refreshTrackedMods() {
  if (trackedModIds.length === 0) return;

  try {
    trackedListContainer.innerHTML = '<div class="empty-state"><div class="loading"></div></div>';
    const idsParam = encodeURIComponent(JSON.stringify(trackedModIds));
    const res = await fetch(`${API_BASE}/projects?ids=${idsParam}`);
    if (!res.ok) throw new Error('Failed to load tracked projects');
    const data = await res.json();

    trackedModsCache = {};
    for (const project of data) {
      trackedModsCache[project.id] = project;
    }
    trackedModIds = trackedModIds.filter(id => trackedModsCache[id]);
    saveTrackedIds();
    renderTrackedMods();

  } catch (err) {
    console.error(err);
    trackedListContainer.innerHTML = '<div class="empty-state">Failed to update tracked mods status.</div>';
  }
}

function renderSearchResults(hits) {
  searchResultsContainer.innerHTML = '';
  if (hits.length === 0) {
    searchResultsContainer.innerHTML = '<div class="empty-state">No results found</div>';
    return;
  }
  hits.forEach(hit => {
    const clone = searchTemplate.content.cloneNode(true);
    const img = clone.querySelector('.mod-icon');
    img.src = hit.icon_url || 'https://cdn.modrinth.com/placeholder.svg';
    img.alt = hit.title;
    clone.querySelector('.mod-title').textContent = hit.title;
    const typeLabel = hit.project_type.charAt(0).toUpperCase() + hit.project_type.slice(1);
    const downloads = hit.downloads ? hit.downloads.toLocaleString() : '0';
    clone.querySelector('.mod-author').textContent = hit.author;
    clone.querySelector('.mod-type').textContent = typeLabel;
    clone.querySelector('.mod-stats').textContent = `${downloads} downloads`;
    const btn = clone.querySelector('.add-button');
    if (trackedModIds.includes(hit.project_id)) {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      btn.style.color = 'var(--success)';
      btn.disabled = true;
      btn.title = 'Already tracked';
    } else {
      btn.addEventListener('click', () => addTrackedMod(hit.project_id, hit));
    }
    searchResultsContainer.appendChild(clone);
  });
}

function renderTrackedMods() {
  trackedListContainer.innerHTML = '';
  if (trackedModIds.length === 0) {
    trackedListContainer.innerHTML = '<div class="empty-state">No content tracked yet. Search and add some!</div>';
    updateSummary(0, 0);
    return;
  }

  const sortMethod = localStorage.getItem('modtracker_sort') || 'added';
  const displayIds = [...trackedModIds];

  if (sortMethod !== 'added') {
    displayIds.sort((a, b) => {
      const pA = trackedModsCache[a];
      const pB = trackedModsCache[b];
      if (!pA || !pB) return 0;

      switch (sortMethod) {
        case 'alphabetical':
          return pA.title.localeCompare(pB.title);
        case 'updated':
          return new Date(pB.updated || pB.date_modified) - new Date(pA.updated || pA.date_modified);
        case 'unsupported':
          const isACompatible = pA.game_versions.includes(targetVersion);
          const isBCompatible = pB.game_versions.includes(targetVersion);
          if (isACompatible === isBCompatible) return 0;
          return isACompatible ? 1 : -1;
        default:
          return 0;
      }
    });
  }

  let readyCount = 0;
  displayIds.forEach(id => {
    const project = trackedModsCache[id];
    if (!project) return;
    const clone = trackedTemplate.content.cloneNode(true);
    const img = clone.querySelector('.mod-icon');
    img.src = project.icon_url || 'https://cdn.modrinth.com/placeholder.svg';
    clone.querySelector('.mod-title').textContent = project.title;
    const typeLabel = project.project_type.charAt(0).toUpperCase() + project.project_type.slice(1);
    clone.querySelector('.mod-type').textContent = typeLabel;
    const isCompatible = project.game_versions.includes(targetVersion);
    const badge = clone.querySelector('.status-badge');
    if (isCompatible) {
      badge.textContent = 'Updated';
      badge.classList.add('badge-ready');
      readyCount++;
    } else {
      badge.textContent = 'Waiting';
      badge.classList.add('badge-waiting');
    }

    const modDate = project.updated || project.date_modified;
    if (modDate) {
      clone.querySelector('.mod-date').textContent = `Updated: ${formatDate(modDate)}`;
    }
    const btn = clone.querySelector('.remove-button');
    btn.addEventListener('click', () => removeTrackedMod(id));
    trackedListContainer.appendChild(clone);
  });
  updateSummary(readyCount, trackedModIds.length);
}

function updateSummary(ready, total) {
  if (total === 0) {
    statusSummary.textContent = '0 / 0 Updated';
    statusSummary.className = 'status-summary';
    return;
  }
  statusSummary.textContent = `${ready} / ${total} Updated`;
  if (ready === total) {
    statusSummary.className = 'status-summary all-ready';
    statusSummary.textContent += ' 🎉';
  } else {
    statusSummary.className = 'status-summary';
  }
  updateOptimalVersion();
}

function updateOptimalVersion() {
  const common = findHighestCommonVersion();
  if (common) {
    optimalVersionEl.innerHTML = `All items work on: <span class="version-link">${common}</span>`;
    optimalVersionEl.classList.add('visible');
    const link = optimalVersionEl.querySelector('.version-link');
    link.addEventListener('click', () => {
      targetVersion = common;
      versionSelect.value = common;
      localStorage.setItem('modtracker_version', targetVersion);
      renderTrackedMods();
    });
  } else if (trackedModIds.length > 1) {
    optimalVersionEl.textContent = 'No single version supports all items';
    optimalVersionEl.classList.add('visible');
  } else {
    optimalVersionEl.classList.remove('visible');
  }
}

function findHighestCommonVersion() {
  if (trackedModIds.length === 0) return null;
  const sets = trackedModIds.map(id => {
    const project = trackedModsCache[id];
    return project ? new Set(project.game_versions) : null;
  }).filter(s => s !== null);
  if (sets.length === 0) return null;
  let intersection = [...sets[0]];
  for (let i = 1; i < sets.length; i++) {
    intersection = intersection.filter(v => sets[i].has(v));
  }
  if (intersection.length === 0) return null;
  for (const vData of mcVersions) {
    if (intersection.includes(vData.version)) {
      return vData.version;
    }
  }
  return intersection[0];
}

async function addTrackedMod(id, hitData) {
  if (trackedModIds.includes(id)) return;
  trackedModIds.push(id);
  saveTrackedIds();
  try {
    const res = await fetch(`${API_BASE}/projects?ids=${encodeURIComponent('["' + id + '"]')}`);
    const data = await res.json();
    if (data.length > 0) {
      trackedModsCache[id] = data[0];
    }
  } catch (err) {
    console.error('Failed to fetch mod details', err);
    trackedModsCache[id] = { id, title: hitData.title, icon_url: hitData.icon_url, game_versions: hitData.versions || [] };
  }
  if (searchInput.value.trim()) performSearch(searchInput.value.trim());
  renderTrackedMods();
}

function removeTrackedMod(id) {
  trackedModIds = trackedModIds.filter(modId => modId !== id);
  saveTrackedIds();
  delete trackedModsCache[id];
  if (searchInput.value.trim()) performSearch(searchInput.value.trim());
  renderTrackedMods();
}

function saveTrackedIds() {
  localStorage.setItem('modtracker_ids', JSON.stringify(trackedModIds));
}

function formatDate(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) { return 'Unknown date'; }
}

init();
