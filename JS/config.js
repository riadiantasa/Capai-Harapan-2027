/* =========================================================
   KONFIGURASI APLIKASI - ubah di sini, bukan di logika.
   ========================================================= */
const APP_CONFIG = {
  appName: 'Capai Harapan Juwara',
  appShortName: 'Juwara 2027',
  localAppId: 'juwara-app-2027',
  themeColor: '#e11d48',
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',

  // Daftar username Mitra yang boleh masuk
  allowedUsers: ['riadiantasa'],

  // Google Drive (OAuth Client ID) - TIM IT: ubah bila perlu
  googleClientId: '819898854940-30is2u3p7o7ipqqfopvpfpi4gdms7e54.apps.googleusercontent.com',
  googleScope: 'https://www.googleapis.com/auth/drive.file',

  // Aturan keuangan
  marginSembako: 0.12,            // margin otomatis simulasi
  idealTabunganMin: 12,           // % minimal tabungan ideal
  bisnisMin: 50,                  // % minimal porsi bisnis
  defaultAlokasi: { modalBerjalan: 40, modalTetap: 20, pokok: 20, tabungan: 12, gayaHidup: 8 },
  daysPerMonth: 30,
};
