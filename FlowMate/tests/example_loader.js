/* Dev page: open the built-in FlowJo example and close its report, for screenshots. */
window.addEventListener('load', async () => {
  await FM.importDialogs.flowjoExample();
  setTimeout(() => { const b = Array.from(document.querySelectorAll('.modal button')).find(x => /Close/.test(x.textContent)); if (b) b.click(); }, 200);
});
