const axios = require('axios');

async function testEmployees() {
  try {
    const response = await axios.get('http://localhost:5000/api/v1/employees?limit=10', {
      headers: {
        'x-tenant-id': 'tenant_23823283_f86d_4e30_bfb1_2599f90f6c10', // From previous logs
        'Authorization': 'Bearer YOUR_TOKEN_HERE' // I don't have a token, but I can check the logs for recent requests
      }
    });
    console.log(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}
// I'll just check the logs instead of running this without a token.
