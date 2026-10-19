/**
 * TakeRemo Admin API Client (admin-client.js)
 * Interacts with /api/admin endpoints using existing JWT authentication credentials.
 */

const AdminClient = {
  /**
   * Helper to perform authenticated API calls
   */
  async request(endpoint, options = {}) {
    const headers = options.headers || {};
    
    // If not FormData, default to JSON accept/content-type
    const isFormData = options.body instanceof FormData;
    if (!isFormData) {
      if (!headers['Content-Type'] && options.body) {
        headers['Content-Type'] = 'application/json';
      }
    }
    if (!headers['Accept']) {
      headers['Accept'] = 'application/json';
    }

    // Attach Bearer token if stored locally as fallback to cookies
    try {
      const storedToken = localStorage.getItem('agent_hari_token') || localStorage.getItem('token') || sessionStorage.getItem('token');
      if (storedToken && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }
    } catch (e) {
      // LocalStorage access may be restricted in some sandboxes
    }

    const config = {
      method: options.method || 'GET',
      headers,
      credentials: 'include', // Sends HTTP-only auth cookies (agent_hari_token)
      ...options
    };

    try {
      const response = await fetch(endpoint, config);
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        const error = new Error(data.message || `Request failed with status ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      console.warn(`[AdminClient] Error calling ${endpoint}:`, err.message);
      throw err;
    }
  },

  /**
   * 1. GET /api/admin/dashboard
   * Returns dashboard metrics (totalUsers, totalCalls, activeCalls, completedCalls, service breakdown)
   */
  async getDashboard() {
    return this.request('/api/admin/dashboard');
  },

  /**
   * 2. GET /api/admin/users
   * Returns paginated users with optional search and status filter
   */
  async getUsers({ page = 1, limit = 10, search = '', status = '' } = {}) {
    const params = new URLSearchParams();
    if (page) params.append('page', page);
    if (limit) params.append('limit', limit);
    if (search) params.append('search', search);
    if (status) params.append('status', status);

    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/api/admin/users${qs}`);
  },

  /**
   * Generic Excel File Upload for any service (recruitment, sales, support)
   * POST /api/admin/{service}/upload
   */
  async uploadExcel(service, fileOrData) {
    const validServices = ['recruitment', 'sales', 'support', 'appointment', 'receptionist'];
    const s = String(service || '').toLowerCase();
    if (!validServices.includes(s)) {
      throw new Error(`Invalid service "${service}". Must be recruitment, sales, support, appointment, or receptionist.`);
    }

    if (fileOrData instanceof File || fileOrData instanceof Blob) {
      const formData = new FormData();
      formData.append('file', fileOrData);
      return this.request(`/api/admin/${s}/upload`, {
        method: 'POST',
        body: formData
      });
    } else {
      // JSON payload: { fileName: "candidates.xlsx" }
      const payload = typeof fileOrData === 'object' ? fileOrData : { fileName: String(fileOrData) };
      return this.request(`/api/admin/${s}/upload`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
  },

  /**
   * Generic Campaign Start for any service
   * POST /api/admin/{service}/start
   */
  async startCalling(service, fileId = 'temp-file-id', agentId = '', documentInfo = null) {
    const validServices = ['recruitment', 'sales', 'support', 'appointment', 'receptionist'];
    const s = String(service || '').toLowerCase();
    if (!validServices.includes(s)) {
      throw new Error(`Invalid service "${service}". Must be recruitment, sales, support, appointment, or receptionist.`);
    }

    return this.request(`/api/admin/${s}/start`, {
      method: 'POST',
      body: JSON.stringify(documentInfo ? { fileId, agentId, document: documentInfo } : { fileId, agentId })
    });
  },

  /**
   * The agents (phone number + behaviour) the owner assigned to this admin.
   * GET /api/admin/agents
   */
  async getAgents() {
    return this.request('/api/admin/agents');
  },

  // Service-specific convenience methods
  async uploadRecruitment(fileOrData) {
    return this.uploadExcel('recruitment', fileOrData);
  },
  async startRecruitment(fileId) {
    return this.startCalling('recruitment', fileId);
  },

  async uploadSales(fileOrData) {
    return this.uploadExcel('sales', fileOrData);
  },
  async startSales(fileId) {
    return this.startCalling('sales', fileId);
  },

  async uploadSupport(fileOrData) {
    return this.uploadExcel('support', fileOrData);
  },
  async startSupport(fileId) {
    return this.startCalling('support', fileId);
  },

  /**
   * 3. GET /api/admin/conversations
   * Returns list of conversations with filters
   */
  async getConversations({ service = '', user = '', status = '', date = '', search = '', page = 1, limit = 10 } = {}) {
    const params = new URLSearchParams();
    if (service) params.append('service', service);
    if (user) params.append('user', user);
    if (status) params.append('status', status);
    if (date) params.append('date', date);
    if (search) params.append('search', search);
    if (page) params.append('page', page);
    if (limit) params.append('limit', limit);

    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/api/admin/conversations${qs}`);
  },

  /**
   * 4. GET /api/admin/conversations/:id
   * Returns full conversation details with turn-by-turn transcripts and summary
   */
  async getConversationById(id) {
    if (!id) throw new Error('Conversation ID is required');
    return this.request(`/api/admin/conversations/${encodeURIComponent(id)}`);
  },

  async deleteConversation(id) {
    if (!id) throw new Error('Conversation ID is required');
    return this.request(`/api/admin/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /**
   * 5. GET /api/admin/calls
   * Returns telephony call history logs
   */
  async getCalls({ service = '', status = '', user = '', date = '', search = '', page = 1, limit = 10 } = {}) {
    const params = new URLSearchParams();
    if (service) params.append('service', service);
    if (status) params.append('status', status);
    if (user) params.append('user', user);
    if (date) params.append('date', date);
    if (search) params.append('search', search);
    if (page) params.append('page', page);
    if (limit) params.append('limit', limit);

    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/api/admin/calls${qs}`);
  },

  async deleteCall(id) {
    if (!id) throw new Error('Call ID is required');
    return this.request(`/api/admin/calls/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /**
   * 6. GET /api/admin/{service}/download
   * Downloads the updated Excel workbook with call results
   */
  getDownloadUrl(service, batchId = '') {
    const s = String(service || '').toLowerCase();
    const qs = batchId ? `?batchId=${encodeURIComponent(batchId)}` : '';
    return `/api/admin/${s}/download${qs}`;
  },

  /**
   * 7. Queue Controls
   */
  async getQueueStatus(batchId = '') {
    const qs = batchId ? `?batchId=${encodeURIComponent(batchId)}` : '';
    return this.request(`/api/admin/queue/status${qs}`);
  },

  async pauseQueue() {
    return this.request('/api/admin/queue/pause', { method: 'POST' });
  },

  async resumeQueue() {
    return this.request('/api/admin/queue/resume', { method: 'POST' });
  },

  async cancelQueue(batchId = '') {
    return this.request('/api/admin/queue/cancel', {
      method: 'POST',
      body: JSON.stringify({ batchId })
    });
  },

  /**
   * 8. Trigger Test Call
   */
  async testCall({ phone, name, service }) {
    return this.request('/api/admin/test-call', {
      method: 'POST',
      body: JSON.stringify({ phone, name, service })
    });
  },

  /**
   * 9. CAMPAIGN MANAGEMENT CLIENT API
   */
  async getCampaigns({ service = '', status = '' } = {}) {
    const params = new URLSearchParams();
    if (service) params.append('service', service);
    if (status) params.append('status', status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/api/admin/campaigns${qs}`);
  },

  async getCampaign(id) {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}`);
  },

  async createCampaign(data) {
    return this.request('/api/admin/campaigns', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateCampaign(id, data) {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async previewCampaignDocument(file, service = 'recruitment') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('service', service);
    return this.request('/api/admin/campaigns/preview-doc', {
      method: 'POST',
      body: formData
    });
  },

  async previewCampaignPdf(file, service = 'recruitment') {
    return this.previewCampaignDocument(file, service);
  },

  async uploadCampaignDocument(id, file) {
    if (!id) throw new Error('Campaign ID is required');
    const formData = new FormData();
    formData.append('file', file);
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}/upload-doc`, {
      method: 'POST',
      body: formData
    });
  },

  async uploadCampaignPdf(id, file) {
    return this.uploadCampaignDocument(id, file);
  },

  async removeCampaignDocument(id) {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}/document`, {
      method: 'DELETE'
    });
  },

  async uploadCampaignExcel(id, file) {
    if (!id) throw new Error('Campaign ID is required');
    const formData = new FormData();
    formData.append('file', file);
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}/upload-excel`, {
      method: 'POST',
      body: formData
    });
  },

  async startCampaign(id, agentId = '') {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}/start`, {
      method: 'POST',
      body: JSON.stringify({ agentId })
    });
  },

  async pauseCampaign(id) {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}/pause`, {
      method: 'POST'
    });
  },

  async resumeCampaign(id) {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}/resume`, {
      method: 'POST'
    });
  },

  async duplicateCampaign(id) {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST'
    });
  },

  async deleteCampaign(id) {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  async archiveCampaign(id) {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}/archive`, {
      method: 'POST'
    });
  },

  async getCampaignConversations(id) {
    if (!id) throw new Error('Campaign ID is required');
    return this.request(`/api/admin/campaigns/${encodeURIComponent(id)}/conversations`);
  },

  getCampaignDownloadUrl(id) {
    return `/api/admin/campaigns/${encodeURIComponent(id)}/download`;
  }
};

window.AdminClient = AdminClient;

