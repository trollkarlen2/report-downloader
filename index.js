const puppeteer = require('puppeteer');
const path = require('path')
const http = require('http');
const fs = require('fs');

function download(url, dest, callback) {
  var file = fs.createWriteStream(dest);
  var request = http.get(url, function(response) {
    response.pipe(file);
    file.on('finish', function() {
      file.close(callback);
    });
  });
}

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    })
}

const configFile = process.argv[2] || 'config.json'

if (!fs.existsSync(configFile)) {
    console.log(`Could not file configuration file ${configFile}.`)
    return
}

const config = JSON.parse(fs.readFileSync(configFile));

if (!config.username || !config.password) {
    console.log('Credentials not specified in configuration.')
    return
}

(async () => {

    console.log(path.resolve('.'))

    const browser = await puppeteer.launch({
        headless: true
    });
    const page = await browser.newPage();
    page.setViewport({
        width: 1600,
        height: 1000,
        isLandscape: 1600 > 1000
    })
    await page.goto('https://entre.stofast.se');
    const usernameField = await page.waitForSelector("input[name='Username']")
    await usernameField.type(config.username)
    const passwordField = await page.waitForSelector("input[name='Password']")
    await passwordField.type(config.password)

    page.on('dialog', async dialog => {
        console.log('Dismissing pop-up window.');
        await dialog.dismiss();
    });

    console.log(`Logging in as ${config.username}.`)
    page.click('#loginSubmitButton')

    const reportsLink = await page.waitForSelector("div[data-id='C12579AC0034E010C125826A003198F2'] > a")

    const p = new Promise(resolve => {
        browser.once("targetcreated", async (target) => {
            console.log('New window opened. Assume it is the Xpand report application.');
            resolve(target);
        })
        reportsLink.click();
    });

    const t = await p;
    const newPage = await t.page();

    if (newPage) {
        const reportName = 'Boendeinformation'
        const reportLinkRow = await newPage.waitForXPath(`//tr[td/span/text()='${reportName}']`)
        reportLinkRow.click();

        console.log('Choosing the correct report.')

        newPage.waitForSelector("#ctl00_UpdateProgress", { visible: true });
        newPage.waitForSelector("#ctl00_UpdateProgress", { hidden: true });

        const runLink = await newPage.waitForXPath("//div[@class='GroupContainer']//a[text()='Kör']")

        runLink.click();

        console.log('Waiting for initial report to be generated.')

        //await newPage._client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve('.') })
        const excelLink = await newPage.waitForXPath("//div[contains(@id, 'pnlReport')]//a[contains(@id, 'lbtExcel')]", { visible: true });

        console.log('Found link to download report as Excel file.')

        const e = new Promise(resolve => {
            newPage.on('response', async response => {
                const body = await response.text()
                const match = body.match(/[a-f0-9-]{36}\.xlsx/)
                if (match) {
                    console.log('An http request returned a page containing the filename of an Excel file.')
                    resolve(match[0]);
                }
            })
            excelLink.click()
        });

        const excelFileName = await e;
        const excelFileUrl = `http://tstxpandwebb.stofast.se/IncitXpandWeb16440_1/Temp/${excelFileName}`

        const downloader = new Promise(resolve => {
            const safeReportTitle = reportName.replace(/[^A-Za-z0-9]/, '')
            const excelFileLocal = `./${safeReportTitle}-${Date.now()}.xlsx`
            console.log(`Attempting to download ${excelFileUrl} to ${excelFileLocal}.`)
            download(excelFileUrl, excelFileLocal, () => {
                console.log('Download complete.')
                resolve(true);
            })
        })

        const downloadResult = await downloader

        console.log(`Download result: ${downloadResult}.`)

        await browser.close();
    }
})();