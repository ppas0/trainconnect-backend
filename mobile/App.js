/**
 * TrainConnect Europe – React Native App (Expo)
 * 
 * SETUP:
 *   npm install -g expo-cli
 *   cd mobile
 *   npm install
 *   npx expo start
 * 
 * BUILD (iOS):  npx expo build:ios
 * BUILD (Android): npx expo build:android
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, SafeAreaView,
  FlatList, RefreshControl, Platform, StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── CONFIG ────────────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:3000/api'; // Change to your server URL in production

const COLORS = {
  navy: '#0f1f3d', navyL: '#1a2d5e', gold: '#c8a96e', goldL: '#dfc28e',
  cream: '#f5f0e8', white: '#ffffff', green: '#2d9a6b', red: '#c84b4b',
  gray: '#8892a4', grayL: '#e8ecf2',
};

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API_BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Fehler');
  return d;
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken]   = useState(null);
  const [user, setUser]     = useState(null);
  const [screen, setScreen] = useState('home'); // home | search | tickets | login | register

  useEffect(() => {
    AsyncStorage.getItem('tc_token').then(t => {
      if (t) { setToken(t); AsyncStorage.getItem('tc_user').then(u => u && setUser(JSON.parse(u))); }
    });
  }, []);

  const login = (d) => {
    setToken(d.token); setUser(d.user);
    AsyncStorage.setItem('tc_token', d.token);
    AsyncStorage.setItem('tc_user', JSON.stringify(d.user));
  };
  const logout = () => {
    setToken(null); setUser(null);
    AsyncStorage.removeItem('tc_token'); AsyncStorage.removeItem('tc_user');
    setScreen('home');
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.navy} />
      <Header user={user} screen={screen} setScreen={setScreen} logout={logout} />
      {screen === 'home'     && <HomeScreen token={token} setScreen={setScreen} />}
      {screen === 'tickets'  && <TicketsScreen token={token} setScreen={setScreen} />}
      {screen === 'login'    && <LoginScreen api={api} login={login} setScreen={setScreen} />}
      {screen === 'register' && <RegisterScreen api={api} login={login} setScreen={setScreen} />}
      <TabBar screen={screen} setScreen={setScreen} user={user} />
    </SafeAreaView>
  );
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function Header({ user, screen, logout }) {
  return (
    <View style={s.header}>
      <Text style={s.logoText}>🚆 TrainConnect</Text>
      {user
        ? <TouchableOpacity onPress={logout}><Text style={s.headerBtn}>Abmelden</Text></TouchableOpacity>
        : <Text style={s.headerSub}>Europe</Text>
      }
    </View>
  );
}

// ── TAB BAR ───────────────────────────────────────────────────────────────────
function TabBar({ screen, setScreen, user }) {
  const tabs = [
    { id:'home', icon:'🔍', label:'Suchen' },
    { id:'tickets', icon:'🎫', label:'Tickets', auth:true },
    { id: user?.role==='admin'?'admin':'login', icon:'👤', label: user?user.name.split(' ')[0]:'Anmelden' },
  ];
  return (
    <View style={s.tabBar}>
      {tabs.map(t => (
        <TouchableOpacity key={t.id} style={s.tab} onPress={() => setScreen(t.auth && !user ? 'login' : t.id)}>
          <Text style={s.tabIcon}>{t.icon}</Text>
          <Text style={[s.tabLabel, screen===t.id && s.tabActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── HOME / SEARCH SCREEN ──────────────────────────────────────────────────────
function HomeScreen({ token, setScreen }) {
  const [from, setFrom]     = useState({ id:'', name:'' });
  const [to, setTo]         = useState({ id:'', name:'' });
  const [date, setDate]     = useState(() => { const d=new Date(); d.setDate(d.getDate()+1); return d.toISOString().split('T')[0]; });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromSugg, setFromSugg] = useState([]);
  const [toSugg, setToSugg]   = useState([]);

  const searchStation = async (q, setter) => {
    if (!q) { setter([]); return; }
    try { const d = await api('GET',`/stations/search?q=${q}`); setter(d); } catch{}
  };

  const search = async () => {
    if (!token)  { Alert.alert('Nicht angemeldet','Bitte zuerst anmelden'); return; }
    if (!from.id) return Alert.alert('Fehler','Bitte Abfahrtsbahnhof wählen');
    if (!to.id)   return Alert.alert('Fehler','Bitte Zielbahnhof wählen');
    setLoading(true); setResults([]);
    try {
      const d = await api('GET',`/search?from=${from.id}&to=${to.id}&date=${date}&passengers=1&class=2`, null, token);
      setResults(d.results);
    } catch(e) { Alert.alert('Fehler', e.message); }
    finally { setLoading(false); }
  };

  const book = async (conn) => {
    if (!token) { Alert.alert('Nicht angemeldet','Bitte zuerst anmelden'); return; }
    Alert.alert(
      'Ticket buchen',
      `${conn.fromStation} → ${conn.toStation}\n${conn.trainNumber}\n\nPreis: €${conn.price}`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: `€${conn.price} buchen`, onPress: async () => {
          try {
            const r = await api('POST','/checkout',{ connection:conn, paymentMethod:'card' }, token);
            Alert.alert('✅ Erfolgreich!', r.message);
            setResults([]);
          } catch(e) { Alert.alert('Fehler', e.message); }
        }}
      ]
    );
  };

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <View style={s.heroMobile}>
        <Text style={s.heroTitle}>Ein Ticket.{'\n'}<Text style={s.heroGold}>Ganz Europa.</Text></Text>
        <Text style={s.heroSub}>Alle europäischen Bahnen auf einer Plattform.</Text>
      </View>

      <View style={s.searchCard}>
        <Text style={s.fieldLabel}>VON</Text>
        <TextInput style={s.input} placeholder="Berlin Hbf, Zürich HB …" value={from.name}
          onChangeText={v => { setFrom({id:'',name:v}); searchStation(v, setFromSugg); }} />
        {fromSugg.map(st => (
          <TouchableOpacity key={st.id} style={s.sugg} onPress={() => { setFrom({id:st.id,name:st.name}); setFromSugg([]); }}>
            <Text style={s.suggText}>{st.name} <Text style={s.suggCity}>{st.city}</Text></Text>
          </TouchableOpacity>
        ))}

        <Text style={s.fieldLabel}>NACH</Text>
        <TextInput style={s.input} placeholder="Wien Hbf, Amsterdam …" value={to.name}
          onChangeText={v => { setTo({id:'',name:v}); searchStation(v, setToSugg); }} />
        {toSugg.map(st => (
          <TouchableOpacity key={st.id} style={s.sugg} onPress={() => { setTo({id:st.id,name:st.name}); setToSugg([]); }}>
            <Text style={s.suggText}>{st.name} <Text style={s.suggCity}>{st.city}</Text></Text>
          </TouchableOpacity>
        ))}

        <Text style={s.fieldLabel}>DATUM</Text>
        <TextInput style={s.input} placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} />

        <TouchableOpacity style={s.searchBtn} onPress={search}>
          <Text style={s.searchBtnText}>{loading ? '⏳ Suche läuft…' : '🔍 Verbindungen suchen'}</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator color={COLORS.gold} size="large" style={{ margin:20 }} />}

      {results.map((r, i) => (
        <View key={r.id} style={s.resultCard}>
          <View style={s.rcRow}>
            <View>
              <Text style={s.rcTime}>{new Date(r.departureTime).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</Text>
              <Text style={s.rcStn}>{r.fromStation}</Text>
            </View>
            <View style={s.rcMid}>
              <Text style={s.rcDur}>{r.duration}</Text>
              <View style={s.rcLine} />
              <Text style={s.rcChg}>{r.changes===0?'Direkt':r.changes+' Umstieg'}</Text>
            </View>
            <View>
              <Text style={s.rcTime}>{new Date(r.arrivalTime).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</Text>
              <Text style={s.rcStn}>{r.toStation}</Text>
            </View>
          </View>
          <Text style={s.rcInfo}>{r.trainNumber} · {r.operator}</Text>
          <View style={s.rcFoot}>
            <View style={s.rcBadges}>
              {r.changes===0 && <Text style={s.bdgDirect}>✓ Direkt</Text>}
              {r.isNightTrain && <Text style={s.bdgNight}>🌙 Nachtzug</Text>}
            </View>
            <View style={s.rcPriceCol}>
              <Text style={s.rcPrice}>€{r.price}</Text>
              <TouchableOpacity style={s.bookBtn} onPress={() => book(r)}>
                <Text style={s.bookBtnText}>Buchen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ── TICKETS SCREEN ────────────────────────────────────────────────────────────
function TicketsScreen({ token, setScreen }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setScreen('login'); return; }
    try { const d = await api('GET','/tickets',null,token); setTickets(d); }
    catch(e) { Alert.alert('Fehler',e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <ActivityIndicator color={COLORS.gold} size="large" style={{flex:1,justifyContent:'center'}} />;

  return (
    <FlatList data={tickets} keyExtractor={t=>t.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);load();}} />}
      ListEmptyComponent={<View style={s.empty}><Text style={s.emptyText}>Noch keine Tickets</Text></View>}
      renderItem={({item:t}) => (
        <View style={s.ticketCard}>
          <View style={s.tcHead}><Text style={s.tcRoute}>{t.fromStation} → {t.toStation}</Text><Text style={s.tcCode}>{t.ticketCode}</Text></View>
          <View style={s.tcBody}>
            <Text style={s.tcInfo}>🚂 {t.trainNumber} · {t.operator}</Text>
            <Text style={s.tcInfo}>📅 {new Date(t.departureTime).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</Text>
            <Text style={s.tcInfo}>💰 €{t.price} · {t.seatClass}. Klasse</Text>
            <Text style={[s.tcInfo, t.status==='confirmed'?s.tcOk:s.tcCx]}>
              {t.status==='confirmed'?'✓ Bestätigt':'✗ Storniert'}
            </Text>
          </View>
        </View>
      )}
    />
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginScreen({ api, login, setScreen }) {
  const [email, setEmail] = useState('');
  const [pw, setPw]       = useState('');
  const doLogin = async () => {
    try { const d = await api('POST','/auth/login',{email,password:pw}); login(d); setScreen('home'); }
    catch(e) { Alert.alert('Fehler',e.message); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.authCenter}>
      <Text style={s.authTitle}>Anmelden</Text>
      <TextInput style={s.input} placeholder="E-Mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={s.input} placeholder="Passwort" value={pw} onChangeText={setPw} secureTextEntry />
      <TouchableOpacity style={s.searchBtn} onPress={doLogin}><Text style={s.searchBtnText}>Anmelden</Text></TouchableOpacity>
      <TouchableOpacity onPress={()=>setScreen('register')}><Text style={s.authSwitch}>Noch kein Konto? Registrieren →</Text></TouchableOpacity>
    </ScrollView>
  );
}

// ── REGISTER ──────────────────────────────────────────────────────────────────
function RegisterScreen({ api, login, setScreen }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw]     = useState('');
  const doReg = async () => {
    try { const d = await api('POST','/auth/register',{name,email,password:pw}); login(d); setScreen('home'); }
    catch(e) { Alert.alert('Fehler',e.message); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.authCenter}>
      <Text style={s.authTitle}>Konto erstellen</Text>
      <TextInput style={s.input} placeholder="Vollständiger Name" value={name} onChangeText={setName} />
      <TextInput style={s.input} placeholder="E-Mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={s.input} placeholder="Passwort (min. 6 Zeichen)" value={pw} onChangeText={setPw} secureTextEntry />
      <TouchableOpacity style={s.searchBtn} onPress={doReg}><Text style={s.searchBtnText}>Konto erstellen</Text></TouchableOpacity>
      <TouchableOpacity onPress={()=>setScreen('login')}><Text style={s.authSwitch}>Schon ein Konto? Anmelden →</Text></TouchableOpacity>
    </ScrollView>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex:1, backgroundColor:COLORS.cream },
  header: { backgroundColor:COLORS.navy, flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, paddingTop: Platform.OS==='android'?StatusBar.currentHeight+8:16 },
  logoText: { color:COLORS.gold, fontSize:20, fontWeight:'700' },
  headerBtn: { color:COLORS.cream, fontSize:14 },
  headerSub: { color:'rgba(245,240,232,.5)', fontSize:13 },
  tabBar: { flexDirection:'row', backgroundColor:COLORS.navy, borderTopWidth:1, borderTopColor:'rgba(200,169,110,.2)' },
  tab: { flex:1, alignItems:'center', padding:10 },
  tabIcon: { fontSize:18 },
  tabLabel: { color:'rgba(245,240,232,.5)', fontSize:11, marginTop:2 },
  tabActive: { color:COLORS.gold },
  screen: { flex:1 },
  heroMobile: { backgroundColor:COLORS.navy, padding:24, paddingBottom:32 },
  heroTitle: { color:COLORS.white, fontSize:28, fontWeight:'700', lineHeight:34 },
  heroGold: { color:COLORS.gold },
  heroSub: { color:'rgba(245,240,232,.6)', fontSize:14, marginTop:8 },
  searchCard: { margin:16, backgroundColor:COLORS.white, borderRadius:12, padding:16, shadowColor:'#000', shadowOpacity:.1, shadowRadius:8, elevation:4, marginTop:-16 },
  fieldLabel: { fontSize:10, fontWeight:'600', color:COLORS.gray, letterSpacing:0.8, marginBottom:4, marginTop:12 },
  input: { borderWidth:1.5, borderColor:COLORS.grayL, borderRadius:8, padding:10, fontSize:14, color:COLORS.navy, backgroundColor:'#f5f0e8' },
  sugg: { borderBottomWidth:1, borderBottomColor:COLORS.grayL, padding:10 },
  suggText: { fontSize:13, color:COLORS.navy },
  suggCity: { color:COLORS.gray, fontSize:12 },
  searchBtn: { backgroundColor:COLORS.navy, borderRadius:10, padding:14, alignItems:'center', marginTop:16 },
  searchBtnText: { color:COLORS.gold, fontWeight:'700', fontSize:16 },
  resultCard: { backgroundColor:COLORS.white, margin:12, marginTop:0, borderRadius:12, padding:14, shadowColor:'#000', shadowOpacity:.07, shadowRadius:6, elevation:2 },
  rcRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  rcTime: { fontSize:22, fontWeight:'700', color:COLORS.navy },
  rcStn: { fontSize:11, color:COLORS.gray, marginTop:2 },
  rcMid: { alignItems:'center' },
  rcDur: { fontSize:11, color:COLORS.gray },
  rcLine: { width:60, height:1, backgroundColor:COLORS.grayL, marginVertical:4 },
  rcChg: { fontSize:11, color:COLORS.gray },
  rcInfo: { fontSize:11, color:COLORS.gray, marginBottom:8 },
  rcFoot: { flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  rcBadges: { flexDirection:'row', gap:4 },
  bdgDirect: { backgroundColor:'#e8f5ee', color:COLORS.green, fontSize:10, fontWeight:'600', padding:3, paddingHorizontal:6, borderRadius:4 },
  bdgNight: { backgroundColor:'#1a2d5e22', color:COLORS.navyL, fontSize:10, fontWeight:'600', padding:3, paddingHorizontal:6, borderRadius:4 },
  rcPriceCol: { alignItems:'flex-end' },
  rcPrice: { fontSize:20, fontWeight:'700', color:COLORS.navy },
  bookBtn: { backgroundColor:COLORS.gold, borderRadius:8, padding:8, paddingHorizontal:14, marginTop:4 },
  bookBtnText: { color:COLORS.navy, fontWeight:'700', fontSize:13 },
  ticketCard: { margin:12, marginTop:0, backgroundColor:COLORS.white, borderRadius:12, overflow:'hidden', shadowColor:'#000', shadowOpacity:.08, shadowRadius:6, elevation:3 },
  tcHead: { backgroundColor:COLORS.navy, padding:14, flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  tcRoute: { color:COLORS.white, fontSize:15, fontWeight:'600' },
  tcCode: { color:COLORS.gold, fontSize:12, fontFamily:Platform.OS==='ios'?'Courier':'monospace' },
  tcBody: { padding:14 },
  tcInfo: { fontSize:13, color:COLORS.navy, marginBottom:4 },
  tcOk: { color:COLORS.green, fontWeight:'600' },
  tcCx: { color:COLORS.red, fontWeight:'600' },
  empty: { flex:1, alignItems:'center', justifyContent:'center', padding:40 },
  emptyText: { color:COLORS.gray, fontSize:16 },
  authCenter: { padding:24, paddingTop:48 },
  authTitle: { fontSize:26, fontWeight:'700', color:COLORS.navy, marginBottom:24 },
  authSwitch: { color:COLORS.navy, textAlign:'center', marginTop:16, textDecorationLine:'underline' },
});
