// Configuração pública. Nunca coloque tokens ou senhas neste arquivo.
export const config = {
  name: 'Barbearia Teste',
  demo: true, // Manter true no GitHub Pages. Operação comercial exige outra hospedagem.
  business: {legalName:'', document:'', address:'', privacyEmail:'', retentionPolicy:''},
  apiBaseUrl: '', // Ex.: https://api.sua-barbearia.com (HTTPS)
  whatsapp: '', // Código do país + DDD + número, apenas dígitos.
  address: '',
  hours: '',
  services: [
    {id:'corte',name:'Corte de cabelo',description:'Corte, acabamento e finalização para o seu estilo.',price:4500,duration:30,image:'corte-degrade.png'},
    {id:'barba',name:'Barba & cuidado',description:'Desenho, alinhamento e cuidado com os detalhes.',price:3500,duration:30,image:'ritual-barba.png'},
    {id:'combo',name:'Corte + barba',description:'O ritual completo para renovar o visual.',price:7000,duration:60,image:'barbearia-interior.png'}
  ]
};
