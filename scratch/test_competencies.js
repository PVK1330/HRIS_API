'use strict';

const axios = require('axios');

async function runTests() {
  const endpoints = [
    'http://127.0.0.1:5000/api/v1',
    'http://[::1]:5000/api/v1',
    'http://127.0.0.1:5000/api/v1',
    'http://[::1]:5000/api/v1'
  ];

  let baseURL = null;
  console.log('--- PROBING BACKEND ENDPOINTS ---');
  for (const url of endpoints) {
    try {
      console.log(`Probing: ${url}/auth/login...`);
      await axios.post(`${url}/auth/login`, { email: 'test@invalid.com', password: 'bad' });
    } catch (err) {
      if (err.response && err.response.status === 400) {
        // Validation error from auth login means the server is reachable and active!
        baseURL = url;
        break;
      } else if (err.response && err.response.status === 401) {
        baseURL = url;
        break;
      }
      console.log(`Failed for ${url}: ${err.code || err.message}`);
    }
  }

  if (!baseURL) {
    console.error('❌ Could not find any running backend endpoint!');
    process.exit(1);
  }

  console.log(`✔ Found active backend at: ${baseURL}`);
  console.log('--- STARTING COMPETENCY END-TO-END TESTS ---');

  try {
    // 1. Log in
    console.log('\n[1/6] Attempting Login for admin@acme.com...');
    const loginRes = await axios.post(`${baseURL}/auth/login`, {
      email: 'admin@acme.com',
      password: 'admin@acme.com'
    });

    if (!loginRes.data.success || !loginRes.data.data?.token) {
      throw new Error('Login failed: Token not returned');
    }

    const token = loginRes.data.data.token;
    console.log('✔ Login successful!');

    const api = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    // 2. Create Competency
    const testCompName = `Machine Learning - Scratch Test ${Date.now()}`;
    console.log(`\n[2/6] Creating competency: "${testCompName}"...`);
    const createRes = await api.post('/competencies', {
      competencyName: testCompName
    });

    if (!createRes.data.success || !createRes.data.data) {
      throw new Error('Create competency failed');
    }

    const newComp = createRes.data.data;
    console.log(`✔ Competency created successfully! ID: ${newComp.id}`);

    // Try creating a duplicate competency to verify uniqueness check
    console.log('\n[2.5/6] Verifying uniqueness check (creating duplicate)...');
    try {
      await api.post('/competencies', {
        competencyName: testCompName
      });
      console.log('❌ Expected duplicate check to fail, but it succeeded.');
      process.exit(1);
    } catch (dupErr) {
      if (dupErr.response && (dupErr.response.status === 400 || dupErr.response.status === 409)) {
        console.log(`✔ Duplicate check passed (received ${dupErr.response.status})!`);
      } else {
        throw dupErr;
      }
    }

    // 3. Get All Competencies
    console.log('\n[3/6] Fetching all competencies...');
    const listRes = await api.get('/competencies');
    if (!listRes.data.success || !Array.isArray(listRes.data.data)) {
      throw new Error('Failed to fetch competencies list');
    }

    console.log(`✔ Fetched ${listRes.data.data.length} competencies successfully.`);
    const found = listRes.data.data.find(c => c.id === newComp.id);
    if (!found) {
      throw new Error('Created competency not found in the list');
    }
    console.log('✔ Created competency found in the fetched list.');

    // 4. Test Search (case-insensitive regex search)
    console.log('\n[4/6] Testing search query for "scratch"...');
    const searchRes = await api.get('/competencies?search=scratch');
    if (!searchRes.data.success || !Array.isArray(searchRes.data.data)) {
      throw new Error('Search failed');
    }

    console.log(`✔ Search returned ${searchRes.data.data.length} matching competencies.`);
    const searchFound = searchRes.data.data.find(c => c.id === newComp.id);
    if (!searchFound) {
      throw new Error('Search did not return the expected competency');
    }
    console.log('✔ Search correctly found the competency.');

    // 5. Fetch Summary Metrics
    console.log('\n[5/6] Fetching competency summary...');
    const summaryRes = await api.get('/competencies/summary');
    if (!summaryRes.data.success || !summaryRes.data.data) {
      throw new Error('Failed to fetch competency summary');
    }

    const summary = summaryRes.data.data;
    console.log('✔ Competency summary metrics successfully fetched:', summary);
    if (typeof summary.totalCompetencies !== 'number' || typeof summary.createdThisMonth !== 'number') {
      throw new Error('Invalid summary metrics format');
    }

    // 6. Delete Competency
    console.log(`\n[6/6] Deleting competency with ID: ${newComp.id}...`);
    const deleteRes = await api.delete(`/competencies/${newComp.id}`);
    if (!deleteRes.data.success) {
      throw new Error('Delete failed');
    }
    console.log('✔ Competency deleted successfully.');

    // Verify it is no longer returned
    console.log('\nVerifying soft deletion in active list...');
    const postDeleteList = await api.get('/competencies');
    const postDeleteFound = postDeleteList.data.data.find(c => c.id === newComp.id);
    if (postDeleteFound) {
      throw new Error('Deleted competency is still returned in active list!');
    }
    console.log('✔ Verified! Competency is no longer returned in active list.');

    console.log('\n======================================');
    console.log('🎉 ALL COMPETENCY API TESTS PASSED SUCCESSFULLY!');
    console.log('======================================');

  } catch (err) {
    console.error('\n❌ TEST FAILED WITH ERROR:');
    if (err.response) {
      console.error(`Status: ${err.response.status}`);
      console.error('Data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.stack || err.message || err);
    }
    process.exit(1);
  }
}

runTests();
