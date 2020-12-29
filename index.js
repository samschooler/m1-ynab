import dotenv from "dotenv";
import axios from "axios";
import axiosCookieJarSupport from "axios-cookiejar-support";
import tough from "tough-cookie";
import ynab from "ynab";

dotenv.config();

// -----------------------------------------

const YNAB_ACCESS_TOKEN = process.env.YNAB_ACCESS_TOKEN;
const YNAB_BUDGET = process.env.YNAB_BUDGET;
const INVESTMENT_ADJUSTMENT_YNAB_ID = process.env.INVESTMENT_ADJUSTMENT_YNAB_ID;
const APEX_USERNAME = process.env.APEX_USERNAME;
const APEX_PASSWORD = process.env.APEX_PASSWORD;

const ACCOUNTS = [
	{
		name: "M1 Investments",
		ynabAccountID: "348dfb49-47f0-409c-bcfd-38389a2ee07c",
		apexNumber: "5MB23667",
	},
	{
		name: "M1 Roth IRA",
		ynabAccountID: "bb9ce74e-fec6-4465-b066-4cd3e3a20eaa",
		apexNumber: "5MB28334",
	},
	{
		name: "M1 Car Savings",
		ynabAccountID: "420835c1-bfb7-43a1-b2e9-95fb8427b5ad",
		apexNumber: "5MC85241",
	},
];

// -------------------

const APEX_URLS = {
	LOGIN: () => "https://public-api.apexclearing.com/legit/api/v2/session",
	MARGINS: (account) =>
		`https://public-api.apexclearing.com/margin-provider/api/v1/margins/${account}`,
};

const apexLoginBody = `{"user":"","password":"${APEX_PASSWORD}","fingerprint":{"screenWidth":2560,"screenHeight":1440,"windowHeight":1355,"windowWidth":1280,"timezone":"GMT-0700","plugins":[],"hasSessionStorage":true,"cpuNumOfCores":16,"hasLocalStorage":true,"doNotTrack":true,"screenColorDepth":24,"hasIndexedDb":true},"username":"${APEX_USERNAME}"}`;

const run = async () => {
	try {
		const ynabAPI = new ynab.API(YNAB_ACCESS_TOKEN);
		const transport = axios.create({
			withCredentials: true,
		});

		axiosCookieJarSupport.default(transport);
		transport.defaults.jar = new tough.CookieJar();

		console.log("Logging in to APEX Clearing...");

		await transport.post(APEX_URLS.LOGIN(), apexLoginBody, {
			headers: {
				"Content-Type": "application/json",
			},
		});

		const getAccountBalance = async (account) => {
			const marginRes = await transport.get(
				APEX_URLS.MARGINS(account.apexNumber)
			);
			return marginRes.data.totalMarketValue;
		};

		console.log("-- Getting APEX Account Balances...");

		const balances = await Promise.all([
			...ACCOUNTS.map((account) => getAccountBalance(account)),
		]);

		console.log("Getting YNAB Accounts...");

		const ynabAccounts = (
			await Promise.all([
				...ACCOUNTS.map((account) =>
					ynabAPI.accounts.getAccountById(YNAB_BUDGET, account.ynabAccountID)
				),
			])
		)
			.map((res) => res?.data?.account)
			.filter((a) => !!a && !!ACCOUNTS.find((b) => b.ynabAccountID === a.id));

		console.log("-- Getting Uncleared Transactions...");

		const accountsHaveUnclearedTransactions = await Promise.all([
			...ACCOUNTS.map(
				async (account) =>
					(
						await ynabAPI.transactions.getTransactionsByAccount(
							YNAB_BUDGET,
							account.ynabAccountID
						)
					)?.data?.transactions?.findIndex((tr) => tr.cleared !== "cleared") >
						-1 ?? true
			),
		]);

		const transactions = balances
			.map((balance, i) => {
				const ynabAccount = ynabAccounts.find(
					(account) => account.id === ACCOUNTS[i].ynabAccountID
				);

				if (!ynabAccount || accountsHaveUnclearedTransactions[i]) {
					return null;
				}

				const amount = Math.round(balance * 1000) - ynabAccount.balance;

				if (Math.abs(amount) < 1) {
					return null;
				}

				return {
					account_id: ACCOUNTS[i].ynabAccountID,
					category_id: null,
					payee_id: INVESTMENT_ADJUSTMENT_YNAB_ID,
					cleared: ynab.SaveTransaction.ClearedEnum.Cleared,
					approved: true,
					date: ynab.utils.getCurrentDateInISOFormat(),
					amount,
				};
			})
			.filter((a) => !!a);

		if (transactions.length > 0) {
			console.log("Creating Transactions...", transactions);
			try {
				await ynabAPI.transactions.createTransactions(YNAB_BUDGET, {
					transactions,
				});
			} catch (e) {
				console.log("Error while creating transactions", e);
			}
		}

		const skipped = accountsHaveUnclearedTransactions.reduce(
			(a, c) => a + (c ? 1 : 0),
			0
		);

		if (transactions.length > 0 && skipped) {
			console.log("A YNAB account has uncleared transactions! Skipping!");
		}
		if (
			transactions.length > 0 &&
			transactions.length + skipped !== balances.length
		) {
			console.log(
				"A YNAB account either failed to get info or the id is wrong..."
			);
		} else if (transactions.length === 0) {
			console.log("No Transactions Needed! :)");
		}
	} catch (e) {
		console.log("Got error while running...", e);
	}
};

run();
