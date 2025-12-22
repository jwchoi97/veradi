// import { useEffect, useState } from 'react';
// import { fetchHealth, fetchItems } from './api';

// type Item = { id: number; name: string };

// export default function App() {
//   const [health, setHealth] = useState<string>('loading...');
//   const [items, setItems] = useState<Item[]>([]);

//   useEffect(() => {
//     fetchHealth()
//       .then((d) => setHealth(d.status))
//       .catch(() => setHealth('error'));

//     fetchItems()
//       .then(setItems)
//       .catch((e) => console.error(e));
//   }, []);

//   return (
//     <div style={{ fontFamily: '"Noto Sans KR", system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
//       <header style={{
//         background: '#0F0B98',
//         color: 'white',
//         padding: '14px 20px',
//         display: 'flex',
//         alignItems: 'center',
//         justifyContent: 'space-between',
//         boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
//       }}>
//         <div style={{ fontWeight: 800, letterSpacing: '1px', fontSize: 20 }}>VERADI</div>
//         <div style={{ opacity: 0.85, fontSize: 14 }}>Health: {health}</div>
//       </header>

//       <main style={{ padding: 20, background: '#f6f7fb', minHeight: 'calc(100vh - 60px)' }}>
//         <section style={{
//           background: 'white',
//           borderRadius: 12,
//           padding: 16,
//           boxShadow: '0 4px 12px rgba(15,11,152,0.08)',
//           maxWidth: 920,
//           margin: '16px auto'
//         }}>
//           <h2 style={{ marginTop: 0, color: '#0F0B98' }}>Items</h2>
//           <div style={{ overflowX: 'auto' }}>
//             <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
//               <thead>
//                 <tr>
//                   <th style={th}>ID</th>
//                   <th style={th}>Name</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {items.map((it) => (
//                   <tr key={it.id}>
//                     <td style={td}>{it.id}</td>
//                     <td style={td}>{it.name}</td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         </section>
//       </main>
//     </div>
//   );
// }

// const th: React.CSSProperties = {
//   textAlign: 'left',
//   padding: '10px 12px',
//   background: '#eef0ff',
//   color: '#0F0B98',
//   borderBottom: '1px solid #e3e6f4',
//   fontWeight: 700
// };
// const td: React.CSSProperties = {
//   padding: '10px 12px',
//   borderBottom: '1px solid #edf0f6',
//   background: 'white'
// };
