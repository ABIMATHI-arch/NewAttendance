// Improved API detection: Use localhost if on a local domain/IP and not served by the backend itself
const getBaseUrl = () => {
    // Check for manual override (useful if backend and frontend are on different domains)
    const overrideUrl = localStorage.getItem('eduAttendBackendUrl');
    if (overrideUrl) {
        console.log(`[EduAttend] Using Manual API Override: ${overrideUrl}`);
        return overrideUrl;
    }

    const { hostname, port, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
    const isFile = protocol === 'file:';

    // If we are on port 5000, we are being served by the backend already
    if (port === '5000') return '/api';

    // If we are on a known local dev port (like 5500 for Live Server or 3000 for React/Vite)
    // but the backend is on 5000, we need the full URL
    if (isLocal || isFile) return 'http://localhost:5000/api';

    // Production default
    return '/api';
};

const API_URL = getBaseUrl();
console.log(`[EduAttend] API initialized at: ${API_URL}`);

// Shared utility functions
const apiRequest = async (endpoint, options = {}) => {
    const token = localStorage.getItem('eduAttendToken');
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${API_URL}${cleanEndpoint}`.replace(/([^:]\/)\/+/g, "$1");

    try {
        const response = await fetch(url, { ...options, headers });

        const serverHeader = response.headers.get("Server");
        const backendHeader = response.headers.get("X-Backend-Server");
        const contentType = response.headers.get("content-type");

        const text = await response.text();
        let data = {};

        if (contentType && contentType.includes("application/json")) {
            try {
                if (text.trim()) {
                    data = JSON.parse(text);
                } else {
                    data = { message: "Success (No data returned)" };
                }
            } catch (jsonError) {
                console.error("JSON Parse Error. Raw body starts with:", text.substring(0, 100));

                if (text.trim().startsWith('<!DOCTYPE html>') || text.trim().startsWith('<html')) {
                    const errorMsg = backendHeader === 'EduAttend-Node'
                        ? "The backend is alive but returned an HTML error page. Check backend logs for route matching issues."
                        : `The request was intercepted by a different server (${serverHeader || 'Unknown'}). This usually means your deployment's /api route is not correctly pointing to the Node.js backend.`;
                    throw new Error(errorMsg);
                }
                throw new Error(`Invalid JSON from server: ${text.substring(0, 30)}...`);
            }
        } else {
            // Not JSON
            data = text ? { message: text } : {};
            if (text.trim().startsWith('<!DOCTYPE html>') || text.trim().startsWith('<html')) {
                console.group("--- API Error Diagnostics ---");
                console.error("URL:", url);
                console.error("Status:", response.status, response.statusText);
                console.error("Server Header:", serverHeader);
                console.error("Backend Header:", backendHeader);
                console.error("HTML Snippet:", text.substring(0, 250));
                console.groupEnd();

                if (!backendHeader) {
                    data.message = `CRITICAL: The backend server was NOT reached. Request was handled by: ${serverHeader || 'a static host'}. Ensure your deployment configuration routes /api to the Node server.`;
                } else {
                    data.message = `The backend responded with an HTML page for ${url}. This implies a 404 or a server-side redirect occurred.`;
                }
            }
        }

        if (!response.ok) {
            throw new Error(data.message || data.error || `Error ${response.status}: ${response.statusText}`);
        }
        return data;
    } catch (error) {
        if (error.message === 'Failed to fetch') {
            throw new Error('Could not connect to the backend server at ' + url);
        }
        console.error('API Error details:', error);
        throw error;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Password Toggle Logic (Universal)
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');

    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', () => {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            togglePassword.classList.toggle('fa-eye');
            togglePassword.classList.toggle('fa-eye-slash');
        });
    }

    // --- FACULTY LOGIN ---
    const facultyForm = document.getElementById('facultyLoginForm');
    if (facultyForm) {
        facultyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('facultyId').value;
            const password = passwordInput.value;
            const btn = facultyForm.querySelector('.login-button');

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';

            try {
                const data = await apiRequest('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password, role: 'faculty' })
                });

                if (data.role !== 'faculty') {
                    throw new Error('This portal is for faculty only.');
                }

                localStorage.setItem('eduAttendToken', data.token);
                localStorage.setItem('eduAttendUser', JSON.stringify(data));
                window.location.href = 'dashboard.html';
            } catch (error) {
                alert(error.message);
                btn.disabled = false;
                btn.innerHTML = 'Sign In <i class="fa-solid fa-arrow-right"></i>';
            }
        });
    }

    // --- STUDENT LOGIN ---
    const studentForm = document.getElementById('studentLoginForm');
    if (studentForm) {
        studentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('studentEmail').value;
            const password = passwordInput.value;
            const btn = studentForm.querySelector('.login-button');

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking records...';

            try {
                const data = await apiRequest('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password, role: 'student' })
                });

                if (data.role !== 'student') {
                    throw new Error('This portal is for students only.');
                }

                localStorage.setItem('eduAttendToken', data.token);
                localStorage.setItem('eduAttendUser', JSON.stringify(data));
                window.location.href = 'student-dashboard.html';
            } catch (error) {
                alert(error.message);
                btn.disabled = false;
                btn.innerHTML = 'Login <i class="fa-solid fa-arrow-right"></i>';
            }
        });
    }

    // --- DASHBOARD INITIALIZATION ---
    if (window.location.pathname.includes('dashboard.html')) {
        const user = JSON.parse(localStorage.getItem('eduAttendUser'));
        if (!user || user.role !== 'faculty') {
            window.location.href = 'faculty-login.html';
            return;
        }

        // Update UI with user info
        const welcomeText = document.querySelector('.main-content header h1');
        if (welcomeText) welcomeText.textContent = `Welcome, ${user.name || user.username}`;

        loadDashboardStats();
    }

    // --- STUDENT DASHBOARD INITIALIZATION ---
    if (window.location.pathname.includes('student-dashboard.html')) {
        const user = JSON.parse(localStorage.getItem('eduAttendUser'));
        if (!user || user.role !== 'student') {
            window.location.href = 'student-login.html';
            return;
        }

        // Update UI with user info
        const welcomeText = document.querySelector('.main-content header h1');
        const welcomeSubtext = document.querySelector('.main-content header p');
        const userProfileName = document.querySelector('.hide-mobile p');
        const userProfileId = document.querySelector('.hide-mobile p:last-child');
        const userAvatar = document.querySelector('.user-avatar');

        if (welcomeText) welcomeText.textContent = `Student Dashboard`;
        if (welcomeSubtext) welcomeSubtext.textContent = `Welcome back, ${user.name || user.username}!`;
        if (userProfileName) userProfileName.textContent = user.name || user.username;
        if (userProfileId) userProfileId.textContent = `ID: ${user.username || 'N/A'}`;
        if (userAvatar) userAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || user.username)}&background=0284c7&color=fff`;

        loadStudentAttendance();
    }

    // --- ATTENDANCE MARKING PAGE ---
    if (window.location.pathname.includes('attendance.html')) {
        loadStudentsForMarking();

        const searchInput = document.querySelector('.search-box input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                document.querySelectorAll('.student-row').forEach(row => {
                    const name = row.querySelector('.student-name').textContent.toLowerCase();
                    const id = row.querySelector('.student-id').textContent.toLowerCase();
                    row.style.display = (name.includes(term) || id.includes(term)) ? 'flex' : 'none';
                });
            });
        }

        const saveBtn = document.querySelector('.login-button');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                alert('Attendance session saved successfully!');
                window.location.href = 'dashboard.html';
            });
        }

        const markAllBtn = document.getElementById('mark-all-present');
        if (markAllBtn) {
            markAllBtn.addEventListener('click', async () => {
                const buttons = document.querySelectorAll('.btn-p');
                for (const btn of buttons) {
                    if (!btn.classList.contains('active')) {
                        btn.click();
                    }
                }
                alert('All students marked as present!');
            });
        }
    }
});

// Load faculty dashboard stats
async function loadDashboardStats() {
    try {
        const students = await apiRequest('/users/students');
        const stats = document.querySelectorAll('.stat-card h3');
        if (stats.length >= 1) stats[0].textContent = students.length;

        // Fetch recent attendance for the table
        const history = await apiRequest('/attendance/all');
        const tableBody = document.querySelector('table tbody');
        if (tableBody) {
            tableBody.innerHTML = '';
            if (history.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No recent attendance recorded.</td></tr>';
            } else {
                history.slice(0, 5).forEach(record => {
                    const row = document.createElement('tr');
                    const date = new Date(record.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    row.innerHTML = `
                        <td style="display: flex; align-items: center; gap: 0.75rem;">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(record.student.name || record.student.username)}&background=f1f5f9&color=6366f1" style="width: 32px; border-radius: 8px;">
                            ${record.student.name || record.student.username}
                        </td>
                        <td>${record.subject}</td>
                        <td>${date}</td>
                        <td><span class="status-badge ${record.status.toLowerCase()}">${record.status}</span></td>
                    `;
                    tableBody.appendChild(row);
                });
            }
        }
    } catch (error) {
        console.log('Failed to load stats');
    }
}

// Load students for faculty to mark attendance
async function loadStudentsForMarking() {
    const listContainer = document.querySelector('.marking-list');
    if (!listContainer) return;

    try {
        const students = await apiRequest('/users/students');
        listContainer.innerHTML = ''; // Clear placeholders

        if (students.length === 0) {
            listContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: #64748b;">No students found in the database.</div>';
            return;
        }

        students.forEach(student => {
            const row = document.createElement('div');
            row.className = 'student-row';
            row.innerHTML = `
                <div class="student-info">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(student.name || student.username)}&background=f1f5f9&color=6366f1" class="student-avatar">
                    <div>
                        <p class="student-name">${student.name || student.username}</p>
                        <p class="student-id">#${student.username}</p>
                    </div>
                </div>
                <div class="attendance-actions" data-student-id="${student._id}">
                    <button class="action-btn btn-p" onclick="markAttendance('${student._id}', 'Present', this)">Present</button>
                    <button class="action-btn btn-a" onclick="markAttendance('${student._id}', 'Absent', this)">Absent</button>
                    <button class="action-btn btn-l" onclick="markAttendance('${student._id}', 'Late', this)">Late</button>
                </div>
            `;
            listContainer.appendChild(row);
        });
    } catch (error) {
        console.error('Failed to load students:', error);
        listContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: #ef4444;">Error loading students.</div>';
    }
}

// Function to call the API and mark attendance
async function markAttendance(studentId, status, btn) {
    try {
        await apiRequest('/attendance/mark', {
            method: 'POST',
            body: JSON.stringify({
                studentId,
                status,
                subject: 'CS101-A'
            })
        });

        const parent = btn.parentElement;
        parent.querySelectorAll('.action-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

    } catch (error) {
        alert('Failed to mark attendance: ' + error.message);
    }
}

// Load attendance history for student
async function loadStudentAttendance() {
    try {
        const history = await apiRequest('/attendance/my-history');
        const totalClasses = history.length;
        const presentCount = history.filter(a => a.status === 'Present').length;
        const missCount = totalClasses - presentCount;
        const percentage = totalClasses > 0 ? Math.round((presentCount / totalClasses) * 100) : 0;

        // Update UI stats
        const stats = document.querySelectorAll('.stat-card div:first-child');
        if (stats.length >= 4) {
            stats[0].style.background = `conic-gradient(var(--primary-blue) ${percentage}%, #f1f5f9 0)`;
            document.documentElement.style.setProperty('--attendance-pct', `'${percentage}%'`);
            stats[1].textContent = totalClasses;
            stats[2].textContent = presentCount;
            stats[3].textContent = missCount;
        }

        // Update Subject-wise section
        const listContainer = document.querySelector('.performance-list');
        if (listContainer) {
            const subjects = [...new Set(history.map(a => a.subject))];
            let html = '<h3 style="margin-bottom: 1.5rem; color: #1e293b;">Recent Attendance Log</h3>';

            if (history.length === 0) {
                html += '<p style="color: #64748b;">No attendance records found.</p>';
            } else {
                history.slice(0, 10).forEach(record => {
                    html += `
                        <div class="course-item">
                            <div class="course-name">${record.subject}</div>
                            <div style="color: #64748b; font-size: 0.85rem;">${new Date(record.date).toLocaleDateString()}</div>
                            <div style="font-weight: 600;" class="status-${record.status.toLowerCase()}">${record.status}</div>
                        </div>
                    `;
                });
            }
            listContainer.innerHTML = html;
        }
    } catch (error) {
        console.log('Could not load history');
    }
}

// Logout Utility
function logout() {
    localStorage.removeItem('eduAttendToken');
    localStorage.removeItem('eduAttendUser');
    window.location.href = 'index.html';
}
